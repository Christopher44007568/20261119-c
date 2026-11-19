#include "gl_api.h"

#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

#define GL_DEFINE(ret, name, args) ret (*gl##name) args = NULL;
GL_FUNCTIONS(GL_DEFINE)
#undef GL_DEFINE

static void *gl_library;

static void *load_proc(const char *name)
{
    void *proc = (void *)eglGetProcAddress(name);
    if (!proc && gl_library)
        proc = dlsym(gl_library, name);
    return proc;
}

int gl_load_functions(void)
{
    gl_library = dlopen("libGL.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!gl_library) {
        fprintf(stderr, "dlopen(libGL.so.1) failed: %s\n", dlerror());
        return 0;
    }

#define GL_LOAD(ret, name, args)                                                \
    do {                                                                        \
        void *proc = load_proc("gl" #name);                                     \
        memcpy(&gl##name, &proc, sizeof(gl##name));                             \
        if (!gl##name) {                                                        \
            fprintf(stderr, "missing GL entry point: gl%s\n", #name);           \
            return 0;                                                           \
        }                                                                       \
    } while (0);
    GL_FUNCTIONS(GL_LOAD)
#undef GL_LOAD
    return 1;
}

int gl_context_create(GlContext *ctx, int width, int height)
{
    EGLint config_count = 0;
    EGLint major = 0;
    EGLint minor = 0;
    EGLint config_attribs[] = {
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    EGLint context_attribs[] = {
        EGL_CONTEXT_MAJOR_VERSION, 4,
        EGL_CONTEXT_MINOR_VERSION, 5,
        EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
        EGL_NONE
    };
    EGLint surface_attribs[] = {
        EGL_WIDTH, width,
        EGL_HEIGHT, height,
        EGL_NONE
    };
    EGLConfig config = NULL;

    memset(ctx, 0, sizeof(*ctx));
    ctx->display = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA,
                                        NULL, NULL);
    if (ctx->display == NULL) {
        fprintf(stderr, "eglGetPlatformDisplay failed\n");
        return 0;
    }
    if (!eglInitialize(ctx->display, &major, &minor)) {
        fprintf(stderr, "eglInitialize failed: 0x%x\n", eglGetError());
        return 0;
    }
    ctx->major = major;
    ctx->minor = minor;
    if (!eglBindAPI(EGL_OPENGL_API)) {
        fprintf(stderr, "eglBindAPI failed: 0x%x\n", eglGetError());
        return 0;
    }
    if (!eglChooseConfig(ctx->display, config_attribs, &config, 1,
                         &config_count) || config_count < 1) {
        fprintf(stderr, "eglChooseConfig failed: 0x%x\n", eglGetError());
        return 0;
    }
    ctx->context = eglCreateContext(ctx->display, config, NULL,
                                    context_attribs);
    if (ctx->context == NULL) {
        fprintf(stderr, "eglCreateContext failed: 0x%x\n", eglGetError());
        return 0;
    }
    ctx->surface = eglCreatePbufferSurface(ctx->display, config,
                                           surface_attribs);
    if (ctx->surface == NULL) {
        fprintf(stderr, "eglCreatePbufferSurface failed: 0x%x\n",
                eglGetError());
        return 0;
    }
    if (!eglMakeCurrent(ctx->display, ctx->surface, ctx->surface,
                        ctx->context)) {
        fprintf(stderr, "eglMakeCurrent failed: 0x%x\n", eglGetError());
        return 0;
    }
    return 1;
}

void gl_context_destroy(GlContext *ctx)
{
    if (ctx->display) {
        eglMakeCurrent(ctx->display, NULL, NULL, NULL);
        if (ctx->surface)
            eglDestroySurface(ctx->display, ctx->surface);
        if (ctx->context)
            eglDestroyContext(ctx->display, ctx->context);
        eglTerminate(ctx->display);
    }
    if (gl_library) {
        dlclose(gl_library);
        gl_library = NULL;
    }
}

const char *gl_error_name(GLenum error)
{
    switch (error) {
    case GL_NO_ERROR: return "GL_NO_ERROR";
    case 0x0500: return "GL_INVALID_ENUM";
    case 0x0501: return "GL_INVALID_VALUE";
    case 0x0502: return "GL_INVALID_OPERATION";
    case 0x0503: return "GL_STACK_OVERFLOW";
    case 0x0504: return "GL_STACK_UNDERFLOW";
    case 0x0505: return "GL_OUT_OF_MEMORY";
    case 0x0506: return "GL_INVALID_FRAMEBUFFER_OPERATION";
    default: return "GL_UNKNOWN_ERROR";
    }
}
