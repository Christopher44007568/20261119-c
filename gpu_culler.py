from __future__ import annotations

from array import array
from dataclasses import dataclass
from pathlib import Path
import ctypes
from ctypes import c_char_p, c_float, c_int, c_uint, c_uint64, c_void_p

from frustum import (
    CapacityReport,
    Camera,
    Frustum,
    Sphere,
    check_capacity,
    pack_planes,
    pack_spheres,
    visible_sphere_ids,
)
from gl_api import (
    EglContext,
    GL_BUFFER_UPDATE_BARRIER_BIT,
    GL_COLOR_ATTACHMENT0,
    GL_COLOR_BUFFER_BIT,
    GL_COMMAND_BARRIER_BIT,
    GL_COMPILE_STATUS,
    GL_COMPUTE_SHADER,
    GL_DEPTH_TEST,
    GL_DRAW_INDIRECT_BUFFER,
    GL_DYNAMIC_STORAGE_BIT,
    GL_ELEMENT_ARRAY_BARRIER_BIT,
    GL_ELEMENT_ARRAY_BUFFER,
    GL_FRAGMENT_SHADER,
    GL_FRAMEBUFFER,
    GL_FRAMEBUFFER_COMPLETE,
    GL_INFO_LOG_LENGTH,
    GL_LINK_STATUS,
    GL_POINTS,
    GL_ANY_SAMPLES_PASSED,
    GL_PROGRAM_POINT_SIZE,
    GL_QUERY_RESULT,
    GL_RGBA8,
    GL_SHADER_STORAGE_BARRIER_BIT,
    GL_SHADER_STORAGE_BUFFER,
    GL_TEXTURE_2D,
    GL_UNSIGNED_INT,
    GL_VERTEX_SHADER,
    OpenGL,
)


SHADER_DIR = Path(__file__).resolve().parent / "shaders"


def _buffer_pointer(values: array) -> c_void_p:
    return c_void_p(values.buffer_info()[0])


@dataclass(frozen=True)
class RunResult:
    scenario_name: str
    gpu_ids: list[int]
    expected_ids: list[int]
    visible_count: int
    indirect_count: int
    draw_any_samples: bool
    overflow: bool
    capacity: CapacityReport
    gl_error: int
    sync_trace: tuple[str, ...]

    @property
    def ids_match(self) -> bool:
        return sorted(self.gpu_ids) == sorted(self.expected_ids)

    @property
    def passed(self) -> bool:
        return (
            self.ids_match
            and self.indirect_count == len(self.expected_ids)
            and not self.overflow
            and self.gl_error == 0
        )


class GpuFrustumCuller:
    def __init__(
        self,
        instance_capacity: int,
        visible_capacity: int | None = None,
        render_size: int = 64,
    ) -> None:
        if instance_capacity <= 0:
            raise ValueError("instance_capacity must be positive")
        if visible_capacity is None:
            visible_capacity = instance_capacity
        if visible_capacity <= 0:
            raise ValueError("visible_capacity must be positive")

        self.instance_capacity = instance_capacity
        self.visible_capacity = visible_capacity
        self.instance_bytes = instance_capacity * 16
        self.visible_bytes = visible_capacity * 4
        self.indirect_bytes = 20
        self.gl = OpenGL()
        self._compile_programs()
        self._create_buffers()
        self._create_render_target(render_size)
        self._create_query()

    def _compile_shader(self, shader_type: int, filename: str) -> int:
        source = (SHADER_DIR / filename).read_text(encoding="utf-8").encode("utf-8")
        shader = self.gl.glCreateShader(shader_type)
        source_pointer = c_char_p(source)
        length = c_int(len(source))
        self.gl.glShaderSource(
            shader,
            1,
            ctypes.byref(source_pointer),
            ctypes.byref(length),
        )
        self.gl.glCompileShader(shader)
        status = c_int()
        self.gl.glGetShaderiv(shader, GL_COMPILE_STATUS, ctypes.byref(status))
        if not status.value:
            log_length = c_int()
            self.gl.glGetShaderiv(
                shader,
                GL_INFO_LOG_LENGTH,
                ctypes.byref(log_length),
            )
            log = ctypes.create_string_buffer(max(1, log_length.value))
            written = c_int()
            self.gl.glGetShaderInfoLog(
                shader,
                len(log),
                ctypes.byref(written),
                log,
            )
            raise RuntimeError(f"shader compile failed for {filename}: {log.value.decode()}")
        return shader

    def _link_program(self, stages: tuple[tuple[int, str], ...]) -> int:
        shaders = [self._compile_shader(stage_type, name) for stage_type, name in stages]
        program = self.gl.glCreateProgram()
        for shader in shaders:
            self.gl.glAttachShader(program, shader)
        self.gl.glLinkProgram(program)
        self.gl.glUseProgram(0)
        for shader in shaders:
            self.gl.glDeleteShader(shader)

        status = c_int()
        self.gl.glGetProgramiv(program, GL_LINK_STATUS, ctypes.byref(status))
        if not status.value:
            log_length = c_int()
            self.gl.glGetProgramiv(program, GL_INFO_LOG_LENGTH, ctypes.byref(log_length))
            log = ctypes.create_string_buffer(max(1, log_length.value))
            written = c_int()
            self.gl.glGetProgramInfoLog(
                program,
                len(log),
                ctypes.byref(written),
                log,
            )
            raise RuntimeError(f"program link failed: {log.value.decode()}")
        return program

    def _compile_programs(self) -> None:
        self.cull_program = self._link_program(((GL_COMPUTE_SHADER, "cull.comp"),))
        self.args_program = self._link_program(((GL_COMPUTE_SHADER, "draw_args.comp"),))
        self.draw_program = self._link_program(
            ((GL_VERTEX_SHADER, "points.vert"), (GL_FRAGMENT_SHADER, "points.frag"))
        )
        self.cull_instance_count_location = self.gl.glGetUniformLocation(
            self.cull_program,
            b"uInstanceCount",
        )
        self.cull_capacity_location = self.gl.glGetUniformLocation(
            self.cull_program,
            b"uVisibleCapacity",
        )
        self.args_capacity_location = self.gl.glGetUniformLocation(
            self.args_program,
            b"uVisibleCapacity",
        )
        self.draw_view_projection_location = self.gl.glGetUniformLocation(
            self.draw_program,
            b"uViewProjection",
        )
        self.gl.check_error("program setup")

    def _create_buffer(self, size: int) -> c_uint:
        buffer = c_uint()
        self.gl.glCreateBuffers(1, ctypes.byref(buffer))
        self.gl.glNamedBufferStorage(
            buffer.value,
            size,
            None,
            GL_DYNAMIC_STORAGE_BIT,
        )
        return buffer

    def _create_buffers(self) -> None:
        self.instance_buffer = self._create_buffer(self.instance_bytes)
        self.plane_buffer = self._create_buffer(6 * 16)
        self.visible_buffer = self._create_buffer(self.visible_bytes)
        self.counter_buffer = self._create_buffer(8)
        self.indirect_buffer = self._create_buffer(self.indirect_bytes)

        self.vertex_array = c_uint()
        self.gl.glCreateVertexArrays(1, ctypes.byref(self.vertex_array))
        self.gl.glBindVertexArray(self.vertex_array.value)
        self.gl.glVertexArrayElementBuffer(
            self.vertex_array.value,
            self.visible_buffer.value,
        )
        self.gl.glBindVertexArray(0)

        command = (c_uint * 5)(0, 1, 0, 0, 0)
        self.gl.glNamedBufferSubData(
            self.indirect_buffer.value,
            0,
            self.indirect_bytes,
            command,
        )
        self.gl.check_error("buffer allocation")

    def _create_render_target(self, size: int) -> None:
        self.render_size = size
        self.texture = c_uint()
        self.gl.glGenTextures(1, ctypes.byref(self.texture))
        self.gl.glBindTexture(GL_TEXTURE_2D, self.texture.value)
        self.gl.glTexStorage2D(GL_TEXTURE_2D, 1, GL_RGBA8, size, size)

        self.framebuffer = c_uint()
        self.gl.glGenFramebuffers(1, ctypes.byref(self.framebuffer))
        self.gl.glBindFramebuffer(GL_FRAMEBUFFER, self.framebuffer.value)
        self.gl.glFramebufferTexture2D(
            GL_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_TEXTURE_2D,
            self.texture.value,
            0,
        )
        status = self.gl.glCheckFramebufferStatus(GL_FRAMEBUFFER)
        if status != GL_FRAMEBUFFER_COMPLETE:
            raise RuntimeError(f"framebuffer incomplete: 0x{status:X}")
        self.gl.glBindFramebuffer(GL_FRAMEBUFFER, 0)
        self.gl.check_error("render target setup")

    def _create_query(self) -> None:
        self.primitive_query = c_uint()
        self.gl.glGenQueries(1, ctypes.byref(self.primitive_query))
        self.gl.check_error("query setup")

    def run(
        self,
        scenario_name: str,
        spheres: list[Sphere],
        frustum: Frustum,
    ) -> RunResult:
        instance_count = len(spheres)
        capacity = check_capacity(
            instance_count=instance_count,
            instance_capacity=self.instance_capacity,
            visible_capacity=self.visible_capacity,
            indirect_bytes=self.indirect_bytes,
        )

        instance_data = pack_spheres(spheres)
        plane_data = pack_planes(frustum.planes)
        if instance_data:
            self.gl.glNamedBufferSubData(
                self.instance_buffer.value,
                0,
                len(instance_data) * 4,
                _buffer_pointer(instance_data),
            )
        self.gl.glNamedBufferSubData(
            self.plane_buffer.value,
            0,
            len(plane_data) * 4,
            _buffer_pointer(plane_data),
        )

        trace = ["reset indirect.indexCount = 0"]
        zero_counters = (c_uint * 2)(0, 0)
        self.gl.glNamedBufferSubData(
            self.counter_buffer.value,
            0,
            ctypes.sizeof(zero_counters),
            zero_counters,
        )
        reset_command = (c_uint * 5)(0, 1, 0, 0, 0)
        self.gl.glNamedBufferSubData(
            self.indirect_buffer.value,
            0,
            self.indirect_bytes,
            reset_command,
        )

        self.gl.glUseProgram(self.cull_program)
        self.gl.glUniform1ui(self.cull_instance_count_location, instance_count)
        self.gl.glUniform1ui(self.cull_capacity_location, self.visible_capacity)
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            0,
            self.instance_buffer.value,
        )
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            1,
            self.plane_buffer.value,
        )
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            2,
            self.visible_buffer.value,
        )
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            3,
            self.counter_buffer.value,
        )
        group_count = (instance_count + 63) // 64
        if group_count:
            self.gl.glDispatchCompute(group_count, 1, 1)
        self.gl.check_error("cull dispatch")
        trace.append("dispatch cull compute; atomicAdd appends visible IDs")

        self.gl.glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT)
        trace.append("glMemoryBarrier(SHADER_STORAGE_BARRIER_BIT)")

        self.gl.glUseProgram(self.args_program)
        self.gl.glUniform1ui(self.args_capacity_location, self.visible_capacity)
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            0,
            self.counter_buffer.value,
        )
        self.gl.glBindBufferBase(
            GL_SHADER_STORAGE_BUFFER,
            1,
            self.indirect_buffer.value,
        )
        self.gl.glDispatchCompute(1, 1, 1)
        self.gl.check_error("indirect argument dispatch")
        trace.append("dispatch draw_args compute; visibleCount -> indirect.indexCount")

        self.gl.glMemoryBarrier(
            GL_SHADER_STORAGE_BARRIER_BIT
            | GL_ELEMENT_ARRAY_BARRIER_BIT
            | GL_COMMAND_BARRIER_BIT
        )
        trace.append(
            "glMemoryBarrier(SHADER_STORAGE | ELEMENT_ARRAY | COMMAND)"
        )

        self.gl.glUseProgram(self.draw_program)
        matrix = (c_float * 16)(*frustum.view_projection)
        self.gl.glUniformMatrix4fv(
            self.draw_view_projection_location,
            1,
            0,
            matrix,
        )
        self.gl.check_error("draw program setup")
        self.gl.glBindBuffer(GL_DRAW_INDIRECT_BUFFER, self.indirect_buffer.value)
        self.gl.glBindVertexArray(self.vertex_array.value)
        self.gl.glBindFramebuffer(GL_FRAMEBUFFER, self.framebuffer.value)
        self.gl.check_error("draw state setup")
        self.gl.glViewport(0, 0, self.render_size, self.render_size)
        self.gl.glDisable(GL_DEPTH_TEST)
        self.gl.glEnable(GL_PROGRAM_POINT_SIZE)
        self.gl.glClearColor(0.02, 0.03, 0.06, 1.0)
        self.gl.glClear(GL_COLOR_BUFFER_BIT)
        self.gl.check_error("draw target setup")
        self.gl.glBeginQuery(GL_ANY_SAMPLES_PASSED, self.primitive_query.value)
        self.gl.check_error("begin sample query")
        self.gl.glDrawElementsIndirect(GL_POINTS, GL_UNSIGNED_INT, None)
        self.gl.check_error("indirect draw")
        self.gl.glEndQuery(GL_ANY_SAMPLES_PASSED)
        self.gl.check_error("end sample query")
        trace.append("glDrawElementsIndirect(GL_POINTS, GL_UNSIGNED_INT)")

        self.gl.glMemoryBarrier(GL_BUFFER_UPDATE_BARRIER_BIT)
        self.gl.glFinish()
        trace.append("glMemoryBarrier(BUFFER_UPDATE); glFinish; read back")

        visible_count = c_uint()
        overflow = c_uint()
        command = (c_uint * 5)()
        sample_result = c_uint64()
        self.gl.glGetNamedBufferSubData(
            self.counter_buffer.value,
            0,
            ctypes.sizeof(visible_count),
            ctypes.byref(visible_count),
        )
        self.gl.glGetNamedBufferSubData(
            self.counter_buffer.value,
            ctypes.sizeof(visible_count),
            ctypes.sizeof(overflow),
            ctypes.byref(overflow),
        )
        self.gl.glGetNamedBufferSubData(
            self.indirect_buffer.value,
            0,
            self.indirect_bytes,
            command,
        )
        self.gl.glGetQueryObjectui64v(
            self.primitive_query.value,
            GL_QUERY_RESULT,
            ctypes.byref(sample_result),
        )

        readable_count = min(visible_count.value, self.visible_capacity)
        gpu_ids_raw = (c_uint * readable_count)()
        if readable_count:
            self.gl.glGetNamedBufferSubData(
                self.visible_buffer.value,
                0,
                readable_count * 4,
                gpu_ids_raw,
            )

        gl_error = self.gl.glGetError()
        expected_ids = visible_sphere_ids(spheres, frustum.planes)
        return RunResult(
            scenario_name=scenario_name,
            gpu_ids=[int(value) for value in gpu_ids_raw],
            expected_ids=expected_ids,
            visible_count=visible_count.value,
            indirect_count=int(command[0]),
            draw_any_samples=bool(sample_result.value),
            overflow=bool(overflow.value),
            capacity=capacity,
            gl_error=gl_error,
            sync_trace=tuple(trace),
        )

    def close(self) -> None:
        buffers = (
            self.instance_buffer,
            self.plane_buffer,
            self.visible_buffer,
            self.counter_buffer,
            self.indirect_buffer,
        )
        for buffer in buffers:
            self.gl.glDeleteBuffers(1, ctypes.byref(buffer))
        self.gl.glDeleteVertexArrays(1, ctypes.byref(self.vertex_array))
        self.gl.glDeleteFramebuffers(1, ctypes.byref(self.framebuffer))
        self.gl.glDeleteTextures(1, ctypes.byref(self.texture))
        self.gl.glDeleteQueries(1, ctypes.byref(self.primitive_query))
        self.gl.glDeleteProgram(self.cull_program)
        self.gl.glDeleteProgram(self.args_program)
        self.gl.glDeleteProgram(self.draw_program)

    def __enter__(self) -> "GpuFrustumCuller":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()
