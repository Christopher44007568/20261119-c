from __future__ import annotations

import ctypes
from ctypes import (
    POINTER,
    c_char_p,
    c_float,
    c_int,
    c_ssize_t,
    c_ubyte,
    c_uint,
    c_uint64,
    c_void_p,
)


GL_SHADER_STORAGE_BUFFER = 0x90D2
GL_DRAW_INDIRECT_BUFFER = 0x8F3F
GL_ELEMENT_ARRAY_BUFFER = 0x8893
GL_DYNAMIC_STORAGE_BIT = 0x0100
GL_SHADER_STORAGE_BARRIER_BIT = 0x00002000
GL_ELEMENT_ARRAY_BARRIER_BIT = 0x00000002
GL_COMMAND_BARRIER_BIT = 0x00000040
GL_BUFFER_UPDATE_BARRIER_BIT = 0x00000200
GL_UNSIGNED_INT = 0x1405
GL_POINTS = 0x0000
GL_TEXTURE_2D = 0x0DE1
GL_RGBA8 = 0x8058
GL_FRAMEBUFFER = 0x8D40
GL_COLOR_ATTACHMENT0 = 0x8CE0
GL_FRAMEBUFFER_COMPLETE = 0x8CD5
GL_COLOR_BUFFER_BIT = 0x00004000
GL_DEPTH_TEST = 0x0B71
GL_QUERY_RESULT = 0x8866
GL_ANY_SAMPLES_PASSED = 0x8C2F
GL_COMPILE_STATUS = 0x8B81
GL_LINK_STATUS = 0x8B82
GL_INFO_LOG_LENGTH = 0x8B84
GL_VERTEX_SHADER = 0x8B31
GL_FRAGMENT_SHADER = 0x8B30
GL_COMPUTE_SHADER = 0x91B9
GL_PROGRAM_POINT_SIZE = 0x8642
GL_NO_ERROR = 0
GL_VENDOR = 0x1F00
GL_RENDERER = 0x1F01
GL_VERSION = 0x1F02
GL_SHADING_LANGUAGE_VERSION = 0x8B8C

EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_OPENGL_API = 0x30A2
EGL_CONTEXT_MAJOR_VERSION = 0x3098
EGL_CONTEXT_MINOR_VERSION = 0x30FB
EGL_CONTEXT_OPENGL_PROFILE_MASK = 0x30FD
EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT = 0x00000001
EGL_SURFACE_TYPE = 0x3033
EGL_PBUFFER_BIT = 0x0001
EGL_NONE = 0x3038


class EglContext:
    def __init__(self) -> None:
        self.egl = ctypes.CDLL("libEGL.so.1")
        self.display: c_void_p | None = None
        self.context: c_void_p | None = None
        self._configure()
        self._create()

    def _configure(self) -> None:
        egl = self.egl
        egl.eglGetProcAddress.restype = c_void_p
        egl.eglGetProcAddress.argtypes = [c_char_p]
        egl.eglInitialize.restype = c_uint
        egl.eglInitialize.argtypes = [c_void_p, POINTER(c_int), POINTER(c_int)]
        egl.eglBindAPI.restype = c_uint
        egl.eglBindAPI.argtypes = [c_uint]
        egl.eglChooseConfig.restype = c_uint
        egl.eglChooseConfig.argtypes = [
            c_void_p,
            POINTER(c_int),
            POINTER(c_void_p),
            c_int,
            POINTER(c_int),
        ]
        egl.eglCreateContext.restype = c_void_p
        egl.eglCreateContext.argtypes = [
            c_void_p,
            c_void_p,
            c_void_p,
            POINTER(c_int),
        ]
        egl.eglMakeCurrent.restype = c_uint
        egl.eglMakeCurrent.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p]
        egl.eglDestroyContext.restype = c_uint
        egl.eglDestroyContext.argtypes = [c_void_p, c_void_p]
        egl.eglTerminate.restype = c_uint
        egl.eglTerminate.argtypes = [c_void_p]
        egl.eglGetError.restype = c_uint

    def _create(self) -> None:
        get_platform_display = ctypes.CFUNCTYPE(
            c_void_p,
            c_uint,
            c_void_p,
            POINTER(c_int),
        )(self.egl.eglGetProcAddress(b"eglGetPlatformDisplayEXT"))
        self.display = get_platform_display(
            EGL_PLATFORM_SURFACELESS_MESA,
            None,
            None,
        )
        if not self.display:
            raise RuntimeError("EGL surfaceless platform is unavailable")

        major = c_int()
        minor = c_int()
        if not self.egl.eglInitialize(
            self.display,
            ctypes.byref(major),
            ctypes.byref(minor),
        ):
            raise RuntimeError(f"eglInitialize failed: 0x{self.egl.eglGetError():X}")
        if not self.egl.eglBindAPI(EGL_OPENGL_API):
            raise RuntimeError("EGL could not bind the OpenGL API")

        config_attributes = (c_int * 3)(EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_NONE)
        config = c_void_p()
        config_count = c_int()
        if not self.egl.eglChooseConfig(
            self.display,
            config_attributes,
            ctypes.byref(config),
            1,
            ctypes.byref(config_count),
        ) or config_count.value < 1:
            raise RuntimeError("EGL could not find an OpenGL-capable config")

        context_attributes = (c_int * 7)(
            EGL_CONTEXT_MAJOR_VERSION,
            4,
            EGL_CONTEXT_MINOR_VERSION,
            3,
            EGL_CONTEXT_OPENGL_PROFILE_MASK,
            EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
            EGL_NONE,
        )
        self.context = self.egl.eglCreateContext(
            self.display,
            config,
            None,
            context_attributes,
        )
        if not self.context:
            raise RuntimeError(f"eglCreateContext failed: 0x{self.egl.eglGetError():X}")
        if not self.egl.eglMakeCurrent(
            self.display,
            None,
            None,
            self.context,
        ):
            raise RuntimeError("eglMakeCurrent failed for a surfaceless context")

    def close(self) -> None:
        if self.display and self.context:
            self.egl.eglMakeCurrent(self.display, None, None, None)
            self.egl.eglDestroyContext(self.display, self.context)
            self.context = None
        if self.display:
            self.egl.eglTerminate(self.display)
            self.display = None

    def __enter__(self) -> "EglContext":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


class OpenGL:
    def __init__(self) -> None:
        self.lib = ctypes.CDLL("libGL.so.1")
        self._bind_functions()

    def _load(self, name: str, restype, *argtypes) -> None:
        function = getattr(self.lib, name)
        function.restype = restype
        function.argtypes = list(argtypes)
        setattr(self, name, function)

    def _bind_functions(self) -> None:
        uint = c_uint
        enum = c_uint
        int_ = c_int
        size = c_int
        intptr = c_ssize_t
        ptr = c_void_p
        self._load("glGetString", c_char_p, enum)
        self._load("glGetError", enum)
        self._load("glGetIntegerv", None, enum, POINTER(int_))
        self._load("glCreateBuffers", None, size, POINTER(uint))
        self._load("glDeleteBuffers", None, size, POINTER(uint))
        self._load("glNamedBufferStorage", None, uint, intptr, ptr, enum)
        self._load("glNamedBufferSubData", None, uint, intptr, intptr, ptr)
        self._load("glGetNamedBufferSubData", None, uint, intptr, intptr, ptr)
        self._load("glBindBufferBase", None, enum, uint, uint)
        self._load("glBindBuffer", None, enum, uint)
        self._load(
            "glClearNamedBufferSubData",
            None,
            uint,
            enum,
            intptr,
            intptr,
            enum,
            enum,
            ptr,
        )
        self._load("glCreateShader", uint, enum)
        self._load("glDeleteShader", None, uint)
        self._load(
            "glShaderSource",
            None,
            uint,
            size,
            POINTER(c_char_p),
            POINTER(int_),
        )
        self._load("glCompileShader", None, uint)
        self._load("glGetShaderiv", None, uint, enum, POINTER(int_))
        self._load(
            "glGetShaderInfoLog",
            None,
            uint,
            size,
            POINTER(size),
            c_char_p,
        )
        self._load("glCreateProgram", uint)
        self._load("glDeleteProgram", None, uint)
        self._load("glAttachShader", None, uint, uint)
        self._load("glLinkProgram", None, uint)
        self._load("glGetProgramiv", None, uint, enum, POINTER(int_))
        self._load(
            "glGetProgramInfoLog",
            None,
            uint,
            size,
            POINTER(size),
            c_char_p,
        )
        self._load("glUseProgram", None, uint)
        self._load("glGetUniformLocation", int_, uint, c_char_p)
        self._load("glUniform1ui", None, int_, uint)
        self._load(
            "glUniformMatrix4fv",
            None,
            int_,
            size,
            c_ubyte,
            POINTER(c_float),
        )
        self._load("glDispatchCompute", None, uint, uint, uint)
        self._load("glMemoryBarrier", None, enum)
        self._load("glCreateVertexArrays", None, size, POINTER(uint))
        self._load("glDeleteVertexArrays", None, size, POINTER(uint))
        self._load("glBindVertexArray", None, uint)
        self._load("glVertexArrayElementBuffer", None, uint, uint)
        self._load(
            "glDrawElementsIndirect",
            None,
            enum,
            enum,
            ptr,
        )
        self._load("glGenFramebuffers", None, size, POINTER(uint))
        self._load("glDeleteFramebuffers", None, size, POINTER(uint))
        self._load("glBindFramebuffer", None, enum, uint)
        self._load("glGenTextures", None, size, POINTER(uint))
        self._load("glDeleteTextures", None, size, POINTER(uint))
        self._load("glBindTexture", None, enum, uint)
        self._load(
            "glTexStorage2D",
            None,
            enum,
            int_,
            enum,
            size,
            size,
        )
        self._load(
            "glFramebufferTexture2D",
            None,
            enum,
            enum,
            enum,
            uint,
            int_,
        )
        self._load("glCheckFramebufferStatus", enum, enum)
        self._load(
            "glViewport",
            None,
            int_,
            int_,
            size,
            size,
        )
        self._load(
            "glClearColor",
            None,
            c_float,
            c_float,
            c_float,
            c_float,
        )
        self._load("glClear", None, enum)
        self._load("glEnable", None, enum)
        self._load("glDisable", None, enum)
        self._load("glGenQueries", None, size, POINTER(uint))
        self._load("glDeleteQueries", None, size, POINTER(uint))
        self._load("glBeginQuery", None, enum, uint)
        self._load("glEndQuery", None, enum)
        self._load(
            "glGetQueryObjectui64v",
            None,
            uint,
            enum,
            POINTER(c_uint64),
        )
        self._load("glFinish", None)

    def string(self, name: int) -> str:
        value = self.glGetString(name)
        return value.decode("utf-8", "replace") if value else ""

    def check_error(self, stage: str) -> int:
        error = self.glGetError()
        if error != GL_NO_ERROR:
            raise RuntimeError(f"OpenGL error 0x{error:X} after {stage}")
        return error
