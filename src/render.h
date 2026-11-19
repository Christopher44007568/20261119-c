#ifndef RENDER_H
#define RENDER_H

#include "gl_api.h"
#include "image.h"

#define RENDER_WIDTH 512
#define RENDER_HEIGHT 512
#define REFERENCE_SCALE 4
#define FRAME_SAMPLES 61
#define PATH_CAPACITY 256

typedef struct {
    int requested_samples;
    int supported;
    int rendered;
    int is_multisample;
    int effective_samples;
    int actual_color_samples;
    int actual_depth_samples;
    int framebuffer_complete;
    int depth_safe;
    int resolve_depth_object_type;
    int color_width;
    int color_height;
    int depth_width;
    int depth_height;
    int resolve_width;
    int resolve_height;
    long resolve_bytes;
    long color_bytes;
    long depth_bytes;
    long total_bytes;
    double frame_ms_median;
    EdgeMetrics metrics;
    char image_path[PATH_CAPACITY];
    char note[PATH_CAPACITY];
    GLuint color_rb;
    GLuint depth_rb;
    GLuint msaa_fbo;
    GLuint resolve_fbo;
    GLuint resolve_texture;
} RenderMode;

typedef struct {
    GlContext context;
    GLuint geometry_program;
    GLuint present_program;
    GLuint geometry_vao;
    GLuint geometry_vbo;
    GLuint present_vao;
    int geometry_vertices;
    int width;
    int height;
} Renderer;

int query_sample_counts(GLenum internal_format, int *samples, int capacity,
                        int *count);
int samples_supported(GLenum internal_format, int requested);
int renderer_create(Renderer *renderer, int width, int height);
void renderer_destroy(Renderer *renderer);
int mode_create(Renderer *renderer, RenderMode *mode, int samples);
void mode_destroy(RenderMode *mode);
int mode_draw(Renderer *renderer, RenderMode *mode);
int mode_capture(Renderer *renderer, RenderMode *mode, Image *image);
double mode_measure_frame_ms(Renderer *renderer, RenderMode *mode);
int render_reference(Renderer *renderer, Image *reference);

#endif
