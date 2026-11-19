#define _GNU_SOURCE

#include "render.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

enum {
    SCENE_TRIANGLES = 15,
    VERTEX_FLOATS = 6,
    PRESENT_READ_BUFFER = 0x0405
};

typedef struct {
    float x;
    float y;
    float z;
    float r;
    float g;
    float b;
} SceneVertex;

static const char *geometry_vertex_shader =
    "#version 330 core\n"
    "layout(location=0) in vec3 aPosition;\n"
    "layout(location=1) in vec3 aColor;\n"
    "out vec3 vColor;\n"
    "void main() {\n"
    "    vColor = aColor;\n"
    "    gl_Position = vec4(aPosition, 1.0);\n"
    "}\n";

static const char *geometry_fragment_shader =
    "#version 330 core\n"
    "in vec3 vColor;\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = vec4(vColor, 1.0); }\n";

static const char *present_vertex_shader =
    "#version 330 core\n"
    "out vec2 vUV;\n"
    "void main() {\n"
    "    vec2 positions[4] = vec2[](\n"
    "        vec2(-1.0, -1.0), vec2(1.0, -1.0),\n"
    "        vec2(-1.0,  1.0), vec2(1.0,  1.0));\n"
    "    vec2 p = positions[gl_VertexID];\n"
    "    vUV = p * 0.5 + 0.5;\n"
    "    gl_Position = vec4(p, 0.0, 1.0);\n"
    "}\n";

static const char *present_fragment_shader =
    "#version 330 core\n"
    "in vec2 vUV;\n"
    "uniform sampler2D uResolved;\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = texture(uResolved, vUV); }\n";

static int compile_shader(GLenum type, const char *source)
{
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint status = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &status);
    if (status != GL_TRUE) {
        char log[2048] = {0};
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "shader compile failed:\n%s\n", log);
        glDeleteShader(shader);
        return 0;
    }
    return (int)shader;
}

static GLuint make_program(const char *vertex_source,
                           const char *fragment_source)
{
    GLuint vertex = (GLuint)compile_shader(GL_VERTEX_SHADER, vertex_source);
    GLuint fragment = (GLuint)compile_shader(GL_FRAGMENT_SHADER,
                                             fragment_source);
    if (!vertex || !fragment)
        return 0;
    GLuint program = glCreateProgram();
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    GLint status = GL_FALSE;
    glGetProgramiv(program, GL_LINK_STATUS, &status);
    if (status != GL_TRUE) {
        fprintf(stderr, "program link failed\n");
        return 0;
    }
    return program;
}

static int compare_descending(const void *left, const void *right)
{
    int a = *(const int *)left;
    int b = *(const int *)right;
    return (a < b) - (a > b);
}

int query_sample_counts(GLenum internal_format, int *samples, int capacity,
                        int *count)
{
    GLint num = 0;
    *count = 0;
    glGetInternalformativ(GL_RENDERBUFFER, internal_format,
                          GL_NUM_SAMPLE_COUNTS, 1, &num);
    if (num < 0)
        num = 0;
    if (num > capacity)
        num = capacity;
    if (num > 0) {
        glGetInternalformativ(GL_RENDERBUFFER, internal_format,
                              GL_SAMPLE_COUNTS, num, samples);
        *count = (int)num;
        qsort(samples, (size_t)*count, sizeof(*samples),
              compare_descending);
    }
    return 1;
}

int samples_supported(GLenum internal_format, int requested)
{
    int samples[64];
    int count = 0;
    if (!query_sample_counts(internal_format, samples, 64, &count))
        return 0;
    for (int i = 0; i < count; ++i) {
        if (samples[i] == requested)
            return 1;
    }
    return 0;
}

static void add_triangle(SceneVertex *vertices, int *cursor,
                         float positions[3][2], float z,
                         const float color[3])
{
    for (int i = 0; i < 3; ++i) {
        SceneVertex *vertex = &vertices[(*cursor)++];
        vertex->x = positions[i][0];
        vertex->y = positions[i][1];
        vertex->z = z;
        vertex->r = color[0];
        vertex->g = color[1];
        vertex->b = color[2];
    }
}

static int create_scene_geometry(Renderer *renderer)
{
    const float foreground[3] = {0.98f, 0.55f, 0.11f};
    SceneVertex vertices[SCENE_TRIANGLES * 3];
    int cursor = 0;

    for (int i = 0; i < 12; ++i) {
        double angle = (2.0 * M_PI * i / 12.0) + 0.17;
        double tip_radius = 0.055 + 0.006 * (i % 3);
        double base_radius = 0.86 + 0.035 * ((i * 5) % 3);
        double half_width = 0.0060 + 0.0012 * ((i * 7) % 3);
        float positions[3][2] = {
            {(float)(cos(angle) * base_radius),
             (float)(sin(angle) * base_radius)},
            {(float)(cos(angle - half_width) * base_radius),
             (float)(sin(angle - half_width) * base_radius)},
            {(float)(cos(angle + half_width) * base_radius),
             (float)(sin(angle + half_width) * base_radius)}
        };
        float tip_x = (float)(cos(angle) * tip_radius);
        float tip_y = (float)(sin(angle) * tip_radius);
        positions[0][0] = tip_x;
        positions[0][1] = tip_y;
        add_triangle(vertices, &cursor, positions, 0.12f + 0.032f * i,
                     foreground);
    }

    float slivers[3][3][2] = {
        {{-0.96f, -0.63f}, {0.96f, -0.47f}, {0.96f, -0.481f}},
        {{-0.96f, 0.55f}, {0.96f, 0.39f}, {0.96f, 0.401f}},
        {{-0.62f, -0.96f}, {-0.601f, 0.96f}, {-0.611f, 0.96f}}
    };
    for (int i = 0; i < 3; ++i)
        add_triangle(vertices, &cursor, slivers[i], 0.70f + 0.03f * i,
                     foreground);

    glGenVertexArrays(1, &renderer->geometry_vao);
    glGenBuffers(1, &renderer->geometry_vbo);
    glBindVertexArray(renderer->geometry_vao);
    glBindBuffer(GL_ARRAY_BUFFER, renderer->geometry_vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)sizeof(vertices), vertices,
                 GL_STATIC_DRAW);
    glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(SceneVertex),
                          (const void *)0);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(SceneVertex),
                          (const void *)(uintptr_t)(3 * sizeof(float)));
    glEnableVertexAttribArray(0);
    glEnableVertexAttribArray(1);
    glBindVertexArray(0);
    renderer->geometry_vertices = cursor;
    return cursor == SCENE_TRIANGLES * 3;
}

int renderer_create(Renderer *renderer, int width, int height)
{
    memset(renderer, 0, sizeof(*renderer));
    renderer->width = width;
    renderer->height = height;
    if (!gl_context_create(&renderer->context, width, height))
        return 0;
    if (!gl_load_functions())
        return 0;

    const GLubyte *renderer_name = glGetString(GL_RENDERER);
    const GLubyte *version = glGetString(GL_VERSION);
    printf("Renderer: %s\n", renderer_name ? (const char *)renderer_name : "?");
    printf("GL: %s\n", version ? (const char *)version : "?");

    renderer->geometry_program = make_program(geometry_vertex_shader,
                                               geometry_fragment_shader);
    renderer->present_program = make_program(present_vertex_shader,
                                              present_fragment_shader);
    if (!renderer->geometry_program || !renderer->present_program)
        return 0;
    glGenVertexArrays(1, &renderer->present_vao);
    return create_scene_geometry(renderer);
}

void renderer_destroy(Renderer *renderer)
{
    gl_context_destroy(&renderer->context);
}

static const float background_color[4] = {0.035f, 0.045f, 0.075f, 1.0f};

static int query_renderbuffer(GLuint renderbuffer, int *width, int *height,
                              int *samples, GLenum *format)
{
    GLint value = 0;
    glBindRenderbuffer(GL_RENDERBUFFER, renderbuffer);
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_WIDTH,
                                 &value);
    *width = value;
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_HEIGHT,
                                 &value);
    *height = value;
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_SAMPLES,
                                 &value);
    *samples = value;
    glGetRenderbufferParameteriv(GL_RENDERBUFFER,
                                 GL_RENDERBUFFER_INTERNAL_FORMAT, &value);
    *format = (GLenum)value;
    return 1;
}

int mode_create(Renderer *renderer, RenderMode *mode, int samples)
{
    memset(mode, 0, sizeof(*mode));
    mode->requested_samples = samples;
    mode->is_multisample = samples > 1;
    if (samples > 1 &&
        (!samples_supported(GL_RGBA8, samples) ||
         !samples_supported(GL_DEPTH_COMPONENT24, samples))) {
        snprintf(mode->note, sizeof(mode->note),
                 "%dx not present in queried RGBA8/depth24 sample counts; "
                 "not rendered and not labelled MSAA",
                 samples);
        return 1;
    }
    mode->supported = 1;

    glGenFramebuffers(1, &mode->msaa_fbo);
    glGenFramebuffers(1, &mode->resolve_fbo);
    glGenRenderbuffers(1, &mode->color_rb);
    glGenRenderbuffers(1, &mode->depth_rb);
    glGenTextures(1, &mode->resolve_texture);

    glBindRenderbuffer(GL_RENDERBUFFER, mode->color_rb);
    if (mode->is_multisample) {
        glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples, GL_RGBA8,
                                         renderer->width, renderer->height);
    } else {
        glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8,
                              renderer->width, renderer->height);
    }
    GLenum color_format = 0;
    query_renderbuffer(mode->color_rb, &mode->color_width,
                       &mode->color_height, &mode->actual_color_samples,
                       &color_format);

    glBindRenderbuffer(GL_RENDERBUFFER, mode->depth_rb);
    if (mode->is_multisample) {
        glRenderbufferStorageMultisample(GL_RENDERBUFFER, samples,
                                         GL_DEPTH_COMPONENT24,
                                         renderer->width, renderer->height);
    } else {
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24,
                              renderer->width, renderer->height);
    }
    GLenum depth_format = 0;
    query_renderbuffer(mode->depth_rb, &mode->depth_width,
                       &mode->depth_height, &mode->actual_depth_samples,
                       &depth_format);

    glBindFramebuffer(GL_FRAMEBUFFER, mode->msaa_fbo);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                              GL_RENDERBUFFER, mode->color_rb);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
                              GL_RENDERBUFFER, mode->depth_rb);
    GLenum msaa_status = glCheckFramebufferStatus(GL_FRAMEBUFFER);

    glBindTexture(GL_TEXTURE_2D, mode->resolve_texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, renderer->width,
                 renderer->height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glBindFramebuffer(GL_FRAMEBUFFER, mode->resolve_fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                           GL_TEXTURE_2D, mode->resolve_texture, 0);
    glDrawBuffer(GL_COLOR_ATTACHMENT0);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    GLenum resolve_status = glCheckFramebufferStatus(GL_FRAMEBUFFER);

    GLint resolve_depth_type = GL_NONE;
    glGetFramebufferAttachmentParameteriv(
        GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
        GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE, &resolve_depth_type);
    mode->resolve_width = renderer->width;
    mode->resolve_height = renderer->height;
    mode->framebuffer_complete =
        msaa_status == GL_FRAMEBUFFER_COMPLETE &&
        resolve_status == GL_FRAMEBUFFER_COMPLETE;
    mode->depth_safe = resolve_depth_type == GL_NONE;
    mode->resolve_depth_object_type = resolve_depth_type;

    mode->effective_samples =
        mode->is_multisample ? mode->actual_color_samples : 1;
    mode->resolve_bytes =
        (long)renderer->width * renderer->height * 4L;
    mode->color_bytes =
        (long)renderer->width * renderer->height * 4L * mode->effective_samples;
    mode->depth_bytes =
        (long)renderer->width * renderer->height * 4L * mode->effective_samples;
    mode->total_bytes =
        mode->resolve_bytes + mode->color_bytes + mode->depth_bytes;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    fprintf(stderr,
            "mode %dx: color samples=%d depth samples=%d resolve depth=%d "
            "complete=%d\n",
            samples, mode->actual_color_samples, mode->actual_depth_samples,
            resolve_depth_type, mode->framebuffer_complete);
    if (mode->is_multisample &&
        (mode->actual_color_samples != samples ||
         mode->actual_depth_samples != samples)) {
        mode->supported = 0;
        snprintf(mode->note, sizeof(mode->note),
                 "%dx storage was not honored (color=%d depth=%d); "
                 "not rendered as MSAA",
                 samples, mode->actual_color_samples,
                 mode->actual_depth_samples);
    } else if (!mode->framebuffer_complete) {
        mode->supported = 0;
        snprintf(mode->note, sizeof(mode->note),
                 "%dx attachments are not framebuffer complete",
                 samples);
    } else if (!mode->depth_safe) {
        mode->supported = 0;
        snprintf(mode->note, sizeof(mode->note),
                 "%dx resolve FBO unexpectedly has a depth attachment",
                 samples);
    }
    return 1;
}

void mode_destroy(RenderMode *mode)
{
    if (mode->msaa_fbo)
        glDeleteFramebuffers(1, &mode->msaa_fbo);
    if (mode->resolve_fbo)
        glDeleteFramebuffers(1, &mode->resolve_fbo);
    if (mode->color_rb)
        glDeleteRenderbuffers(1, &mode->color_rb);
    if (mode->depth_rb)
        glDeleteRenderbuffers(1, &mode->depth_rb);
    if (mode->resolve_texture)
        glDeleteTextures(1, &mode->resolve_texture);
    memset(mode, 0, sizeof(*mode));
}

static void draw_scene(Renderer *renderer, GLuint framebuffer, int width,
                       int height)
{
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glViewport(0, 0, width, height);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LESS);
    glClearColor(background_color[0], background_color[1],
                 background_color[2], background_color[3]);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glUseProgram(renderer->geometry_program);
    glBindVertexArray(renderer->geometry_vao);
    glDrawArrays(GL_TRIANGLES, 0, renderer->geometry_vertices);
    glBindVertexArray(0);
}

int mode_draw(Renderer *renderer, RenderMode *mode)
{
    draw_scene(renderer, mode->msaa_fbo, renderer->width, renderer->height);

    glBindFramebuffer(GL_READ_FRAMEBUFFER, mode->msaa_fbo);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, mode->resolve_fbo);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glDrawBuffer(GL_COLOR_ATTACHMENT0);
    glBlitFramebuffer(0, 0, renderer->width, renderer->height,
                      0, 0, renderer->width, renderer->height,
                      GL_COLOR_BUFFER_BIT, GL_NEAREST);

    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, renderer->width, renderer->height);
    glDisable(GL_DEPTH_TEST);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    glUseProgram(renderer->present_program);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, mode->resolve_texture);
    glBindVertexArray(renderer->present_vao);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    glBindVertexArray(0);
    glFinish();
    return glGetError() == GL_NO_ERROR;
}

int mode_capture(Renderer *renderer, RenderMode *mode, Image *image)
{
    if (!mode_draw(renderer, mode))
        return 0;
    if (!image_alloc(image, renderer->width, renderer->height))
        return 0;
    size_t row_bytes = (size_t)renderer->width * 4;
    unsigned char *rgba = malloc(row_bytes * (size_t)renderer->height);
    if (!rgba)
        return 0;
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, renderer->width, renderer->height, GL_RGBA,
                 GL_UNSIGNED_BYTE, rgba);
    for (int y = 0; y < renderer->height; ++y) {
        const unsigned char *source =
            rgba + (size_t)(renderer->height - 1 - y) * row_bytes;
        unsigned char *destination =
            image->rgb + (size_t)y * (size_t)renderer->width * 3;
        for (int x = 0; x < renderer->width; ++x) {
            destination[x * 3 + 0] = source[x * 4 + 0];
            destination[x * 3 + 1] = source[x * 4 + 1];
            destination[x * 3 + 2] = source[x * 4 + 2];
        }
    }
    free(rgba);
    return glGetError() == GL_NO_ERROR;
}

static int compare_doubles(const void *left, const void *right)
{
    double a = *(const double *)left;
    double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double now_ms(void)
{
    struct timespec time;
    clock_gettime(CLOCK_MONOTONIC, &time);
    return (double)time.tv_sec * 1000.0 + (double)time.tv_nsec / 1000000.0;
}

double mode_measure_frame_ms(Renderer *renderer, RenderMode *mode)
{
    double samples[FRAME_SAMPLES];
    for (int i = 0; i < 8; ++i)
        mode_draw(renderer, mode);
    glFinish();
    for (int i = 0; i < FRAME_SAMPLES; ++i) {
        double start = now_ms();
        mode_draw(renderer, mode);
        samples[i] = now_ms() - start;
    }
    qsort(samples, FRAME_SAMPLES, sizeof(samples[0]), compare_doubles);
    return samples[FRAME_SAMPLES / 2];
}

int render_reference(Renderer *renderer, Image *reference)
{
    const int scale = REFERENCE_SCALE;
    const int width = renderer->width;
    const int height = renderer->height;
    const int high_width = width * scale;
    const int high_height = height * scale;
    GLuint framebuffer = 0;
    GLuint texture = 0;
    GLuint depth = 0;

    glGenFramebuffers(1, &framebuffer);
    glGenTextures(1, &texture);
    glGenRenderbuffers(1, &depth);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, high_width, high_height, 0,
                 GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glBindRenderbuffer(GL_RENDERBUFFER, depth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24,
                          high_width, high_height);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                           GL_TEXTURE_2D, texture, 0);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
                              GL_RENDERBUFFER, depth);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "reference framebuffer incomplete\n");
        return 0;
    }

    draw_scene(renderer, framebuffer, high_width, high_height);
    size_t rgba_bytes = (size_t)high_width * (size_t)high_height * 4;
    unsigned char *rgba = malloc(rgba_bytes);
    if (!rgba || !image_alloc(reference, width, height))
        return 0;
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, high_width, high_height, GL_RGBA, GL_UNSIGNED_BYTE,
                 rgba);

    for (int y = 0; y < height; ++y) {
        int high_y = (height - 1 - y) * scale;
        unsigned char *destination =
            reference->rgb + (size_t)y * (size_t)width * 3;
        for (int x = 0; x < width; ++x) {
            unsigned int red = 0;
            unsigned int green = 0;
            unsigned int blue = 0;
            for (int sy = 0; sy < scale; ++sy) {
                const unsigned char *row =
                    rgba + (size_t)(high_y + sy) *
                               (size_t)high_width * 4;
                for (int sx = 0; sx < scale; ++sx) {
                    const unsigned char *pixel =
                        row + (size_t)(x * scale + sx) * 4;
                    red += pixel[0];
                    green += pixel[1];
                    blue += pixel[2];
                }
            }
            unsigned int divisor = (unsigned int)(scale * scale);
            destination[x * 3 + 0] = (unsigned char)(red / divisor);
            destination[x * 3 + 1] = (unsigned char)(green / divisor);
            destination[x * 3 + 2] = (unsigned char)(blue / divisor);
        }
    }

    free(rgba);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glDeleteFramebuffers(1, &framebuffer);
    glDeleteRenderbuffers(1, &depth);
    glDeleteTextures(1, &texture);
    glFinish();
    return glGetError() == GL_NO_ERROR;
}
