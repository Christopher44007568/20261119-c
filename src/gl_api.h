#ifndef GL_API_H
#define GL_API_H

#include <stddef.h>
#include <stdint.h>

typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef unsigned int GLbitfield;
typedef unsigned char GLboolean;
typedef unsigned char GLubyte;
typedef int GLint;
typedef int GLsizei;
typedef float GLfloat;
typedef char GLchar;
typedef intptr_t GLintptr;
typedef intptr_t GLsizeiptr;
typedef uint64_t GLuint64;

typedef int32_t EGLint;
typedef unsigned int EGLBoolean;
typedef unsigned int EGLenum;
typedef void *EGLDisplay;
typedef void *EGLConfig;
typedef void *EGLContext;
typedef void *EGLSurface;

enum {
    GL_FALSE = 0,
    GL_TRUE = 1,
    GL_NO_ERROR = 0,
    GL_NONE = 0,
    GL_INT = 0x1404,
    GL_FLOAT = 0x1406,
    GL_RGB = 0x1907,
    GL_RGBA = 0x1908,
    GL_UNSIGNED_BYTE = 0x1401,
    GL_DEPTH_COMPONENT = 0x1902,
    GL_DEPTH_TEST = 0x0B71,
    GL_LESS = 0x0201,
    GL_COLOR_BUFFER_BIT = 0x00004000,
    GL_DEPTH_BUFFER_BIT = 0x00000100,
    GL_TRIANGLES = 0x0004,
    GL_TRIANGLE_STRIP = 0x0005,
    GL_ARRAY_BUFFER = 0x8892,
    GL_STATIC_DRAW = 0x88E4,
    GL_TEXTURE_2D = 0x0DE1,
    GL_TEXTURE0 = 0x84C0,
    GL_TEXTURE_MIN_FILTER = 0x2801,
    GL_TEXTURE_MAG_FILTER = 0x2800,
    GL_TEXTURE_WRAP_S = 0x2802,
    GL_TEXTURE_WRAP_T = 0x2803,
    GL_NEAREST = 0x2600,
    GL_LINEAR = 0x2601,
    GL_CLAMP_TO_EDGE = 0x812F,
    GL_VERTEX_SHADER = 0x8B31,
    GL_FRAGMENT_SHADER = 0x8B30,
    GL_COMPILE_STATUS = 0x8B81,
    GL_LINK_STATUS = 0x8B82,
    GL_INFO_LOG_LENGTH = 0x8B84,
    GL_FRAMEBUFFER = 0x8D40,
    GL_READ_FRAMEBUFFER = 0x8CA8,
    GL_DRAW_FRAMEBUFFER = 0x8CA9,
    GL_RENDERBUFFER = 0x8D41,
    GL_COLOR_ATTACHMENT0 = 0x8CE0,
    GL_DEPTH_ATTACHMENT = 0x8D00,
    GL_FRAMEBUFFER_COMPLETE = 0x8CD5,
    GL_FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE = 0x8CD0,
    GL_FRAMEBUFFER_ATTACHMENT_OBJECT_NAME = 0x8CD1,
    GL_RENDERBUFFER_WIDTH = 0x8D42,
    GL_RENDERBUFFER_HEIGHT = 0x8D43,
    GL_RENDERBUFFER_INTERNAL_FORMAT = 0x8D44,
    GL_RENDERBUFFER_SAMPLES = 0x8CAB,
    GL_RGBA8 = 0x8058,
    GL_DEPTH_COMPONENT24 = 0x81A6,
    GL_NUM_SAMPLE_COUNTS = 0x9380,
    GL_SAMPLE_COUNTS = 0x80A9,
    GL_MAX_SAMPLES = 0x8D57,
    GL_MAX_COLOR_TEXTURE_SAMPLES = 0x910E,
    GL_MAX_DEPTH_TEXTURE_SAMPLES = 0x910F,
    GL_RENDERER = 0x1F01,
    GL_VERSION = 0x1F02,
    GL_VENDOR = 0x1F00,
    GL_PACK_ALIGNMENT = 0x0D05,
    GL_UNPACK_ALIGNMENT = 0x0CF5,
    GL_PIXEL_PACK_BUFFER = 0x88EB,
    GL_TIME_ELAPSED = 0x88BF,
    GL_QUERY_RESULT = 0x8866,
    GL_QUERY_RESULT_AVAILABLE = 0x8867,
    EGL_SUCCESS = 0x3000,
    EGL_NONE = 0x3038,
    EGL_ALPHA_SIZE = 0x3021,
    EGL_BLUE_SIZE = 0x3022,
    EGL_GREEN_SIZE = 0x3023,
    EGL_RED_SIZE = 0x3024,
    EGL_SURFACE_TYPE = 0x3033,
    EGL_PBUFFER_BIT = 0x0001,
    EGL_RENDERABLE_TYPE = 0x3040,
    EGL_OPENGL_BIT = 0x0008,
    EGL_WIDTH = 0x3057,
    EGL_HEIGHT = 0x3056,
    EGL_OPENGL_API = 0x30A2,
    EGL_CONTEXT_MAJOR_VERSION = 0x3098,
    EGL_CONTEXT_MINOR_VERSION = 0x30FB,
    EGL_CONTEXT_OPENGL_PROFILE_MASK = 0x30FD,
    EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT = 0x0001,
    EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
};

#define GL_FUNCTIONS(X) \
    X(const GLubyte *, GetString, (GLenum name)) \
    X(GLenum, GetError, (void)) \
    X(void, GetIntegerv, (GLenum pname, GLint *data)) \
    X(void, Viewport, (GLint x, GLint y, GLsizei w, GLsizei h)) \
    X(void, ClearColor, (GLfloat r, GLfloat g, GLfloat b, GLfloat a)) \
    X(void, Clear, (GLbitfield mask)) \
    X(void, Enable, (GLenum cap)) \
    X(void, Disable, (GLenum cap)) \
    X(void, DepthFunc, (GLenum func)) \
    X(void, PixelStorei, (GLenum pname, GLint param)) \
    X(void, ReadPixels, (GLint x, GLint y, GLsizei w, GLsizei h, GLenum format, GLenum type, void *pixels)) \
    X(void, DrawArrays, (GLenum mode, GLint first, GLsizei count)) \
    X(void, Finish, (void)) \
    X(void, Flush, (void)) \
    X(void, GenFramebuffers, (GLsizei n, GLuint *ids)) \
    X(void, BindFramebuffer, (GLenum target, GLuint fb)) \
    X(void, DeleteFramebuffers, (GLsizei n, const GLuint *ids)) \
    X(GLenum, CheckFramebufferStatus, (GLenum target)) \
    X(void, FramebufferRenderbuffer, (GLenum target, GLenum attachment, GLenum rbTarget, GLuint rb)) \
    X(void, FramebufferTexture2D, (GLenum target, GLenum attachment, GLenum texTarget, GLuint tex, GLint level)) \
    X(void, GetFramebufferAttachmentParameteriv, (GLenum target, GLenum attachment, GLenum pname, GLint *params)) \
    X(void, BlitFramebuffer, (GLint sx0, GLint sy0, GLint sx1, GLint sy1, GLint dx0, GLint dy0, GLint dx1, GLint dy1, GLbitfield mask, GLenum filter)) \
    X(void, ReadBuffer, (GLenum mode)) \
    X(void, DrawBuffer, (GLenum mode)) \
    X(void, GenRenderbuffers, (GLsizei n, GLuint *ids)) \
    X(void, BindRenderbuffer, (GLenum target, GLuint rb)) \
    X(void, DeleteRenderbuffers, (GLsizei n, const GLuint *ids)) \
    X(void, RenderbufferStorage, (GLenum target, GLenum internalformat, GLsizei w, GLsizei h)) \
    X(void, RenderbufferStorageMultisample, (GLenum target, GLsizei samples, GLenum internalformat, GLsizei w, GLsizei h)) \
    X(void, GetRenderbufferParameteriv, (GLenum target, GLenum pname, GLint *params)) \
    X(void, GenTextures, (GLsizei n, GLuint *ids)) \
    X(void, BindTexture, (GLenum target, GLuint tex)) \
    X(void, DeleteTextures, (GLsizei n, const GLuint *ids)) \
    X(void, ActiveTexture, (GLenum texture)) \
    X(void, TexImage2D, (GLenum target, GLint level, GLint internalformat, GLsizei w, GLsizei h, GLint border, GLenum format, GLenum type, const void *pixels)) \
    X(void, TexParameteri, (GLenum target, GLenum pname, GLint param)) \
    X(GLuint, CreateShader, (GLenum type)) \
    X(void, ShaderSource, (GLuint shader, GLsizei count, const GLchar *const *strings, const GLint *lengths)) \
    X(void, CompileShader, (GLuint shader)) \
    X(void, GetShaderiv, (GLuint shader, GLenum pname, GLint *params)) \
    X(void, GetShaderInfoLog, (GLuint shader, GLsizei size, GLsizei *length, GLchar *log)) \
    X(GLuint, CreateProgram, (void)) \
    X(void, AttachShader, (GLuint program, GLuint shader)) \
    X(void, LinkProgram, (GLuint program)) \
    X(void, GetProgramiv, (GLuint program, GLenum pname, GLint *params)) \
    X(void, UseProgram, (GLuint program)) \
    X(void, DeleteShader, (GLuint shader)) \
    X(void, GenVertexArrays, (GLsizei n, GLuint *ids)) \
    X(void, BindVertexArray, (GLuint vao)) \
    X(void, GenBuffers, (GLsizei n, GLuint *ids)) \
    X(void, BindBuffer, (GLenum target, GLuint buffer)) \
    X(void, BufferData, (GLenum target, GLsizeiptr size, const void *data, GLenum usage)) \
    X(void, VertexAttribPointer, (GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void *pointer)) \
    X(void, EnableVertexAttribArray, (GLuint index)) \
    X(void, GetInternalformativ, (GLenum target, GLenum internalformat, GLenum pname, GLsizei bufSize, GLint *params)) \
    X(void, GenQueries, (GLsizei n, GLuint *ids)) \
    X(void, DeleteQueries, (GLsizei n, const GLuint *ids)) \
    X(void, BeginQuery, (GLenum target, GLuint id)) \
    X(void, EndQuery, (GLenum target)) \
    X(void, GetQueryObjectuiv, (GLuint id, GLenum pname, GLuint *params)) \
    X(void, GetQueryObjectui64v, (GLuint id, GLenum pname, GLuint64 *params))

#define GL_DECLARE(ret, name, args) extern ret (*gl##name) args;
GL_FUNCTIONS(GL_DECLARE)
#undef GL_DECLARE

extern EGLDisplay eglGetPlatformDisplay(EGLenum platform, void *native_display, const intptr_t *attrib_list);
extern EGLBoolean eglInitialize(EGLDisplay dpy, EGLint *major, EGLint *minor);
extern EGLBoolean eglBindAPI(EGLenum api);
extern EGLBoolean eglChooseConfig(EGLDisplay dpy, const EGLint *attribs, EGLConfig *configs, EGLint size, EGLint *num);
extern void *eglGetProcAddress(const char *procname);
extern EGLContext eglCreateContext(EGLDisplay dpy, EGLConfig config, EGLContext share, const EGLint *attribs);
extern EGLSurface eglCreatePbufferSurface(EGLDisplay dpy, EGLConfig config, const EGLint *attribs);
extern EGLBoolean eglMakeCurrent(EGLDisplay dpy, EGLSurface draw, EGLSurface read, EGLContext ctx);
extern EGLBoolean eglDestroySurface(EGLDisplay dpy, EGLSurface surface);
extern EGLBoolean eglDestroyContext(EGLDisplay dpy, EGLContext ctx);
extern EGLBoolean eglTerminate(EGLDisplay dpy);
extern EGLint eglGetError(void);

typedef struct {
    EGLDisplay display;
    EGLContext context;
    EGLSurface surface;
    EGLint major;
    EGLint minor;
} GlContext;

int gl_context_create(GlContext *ctx, int width, int height);
void gl_context_destroy(GlContext *ctx);
int gl_load_functions(void);
const char *gl_error_name(GLenum error);

#endif
