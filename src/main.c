#include "image.h"
#include "render.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static void json_string(FILE *file, const char *text)
{
    fputc('"', file);
    for (const unsigned char *cursor = (const unsigned char *)text;
         cursor && *cursor; ++cursor) {
        switch (*cursor) {
        case '"': fputs("\\\"", file); break;
        case '\\': fputs("\\\\", file); break;
        case '\n': fputs("\\n", file); break;
        case '\r': fputs("\\r", file); break;
        case '\t': fputs("\\t", file); break;
        default:
            if (*cursor < 0x20)
                fprintf(file, "\\u%04x", *cursor);
            else
                fputc(*cursor, file);
        }
    }
    fputc('"', file);
}

static void print_sample_counts(const char *label, const int *counts,
                                int count)
{
    printf("%s sample counts (%d):", label, count);
    for (int i = 0; i < count; ++i)
        printf(" %d", counts[i]);
    putchar('\n');
}

static int find_mode(const RenderMode *modes, int count, int samples)
{
    for (int i = 0; i < count; ++i) {
        if (modes[i].requested_samples == samples)
            return i;
    }
    return -1;
}

static const char *mode_tag(int samples)
{
    switch (samples) {
    case 1: return "1x_singlesample";
    case 2: return "2x_msaa";
    case 4: return "4x_msaa";
    case 8: return "8x_msaa";
    default: return "msaa";
    }
}

static void print_mode_row(const RenderMode *mode)
{
    char support[32];
    if (!mode->supported)
        snprintf(support, sizeof(support), "NOT SUPPORTED");
    else if (!mode->is_multisample)
        snprintf(support, sizeof(support), "single-sample");
    else
        snprintf(support, sizeof(support), "MSAA");

    if (!mode->rendered) {
        printf("x%-8d %-14s %-4s %-16s %12s %10s %10s %12s %9s\n",
               mode->requested_samples, support, "-", "-", "-", "-", "-", "-",
               "-");
        return;
    }
    printf("x%-8d %-14s %-4d %dx%-10d %12ld %10.4f %10.6f %12.6f %9.4f\n",
           mode->requested_samples, support, mode->effective_samples,
           mode->color_width, mode->color_height, mode->total_bytes / 1024,
           mode->frame_ms_median, mode->metrics.edge_mae,
           mode->metrics.coverage_mae, mode->metrics.partial_ratio);
}

static void write_sample_counts(FILE *file, const int *counts, int count)
{
    fputc('[', file);
    for (int i = 0; i < count; ++i) {
        if (i)
            fputs(", ", file);
        fprintf(file, "%d", counts[i]);
    }
    fputc(']', file);
}

static void write_mode_json(FILE *file, const RenderMode *mode)
{
    const char *label = !mode->is_multisample
                            ? "single-sample baseline (not MSAA)"
                            : (mode->rendered ? "hardware multisample"
                                              : "unsupported multisample tier");
    fputs("    {\n", file);
    fprintf(file, "      \"mode\": \"x%d\",\n", mode->requested_samples);
    fputs("      \"label\": ", file);
    json_string(file, label);
    fputs(",\n", file);
    fprintf(file, "      \"is_multisample\": %s,\n",
            mode->is_multisample ? "true" : "false");
    fprintf(file, "      \"supported\": %s,\n",
            mode->supported ? "true" : "false");
    fprintf(file, "      \"rendered\": %s,\n",
            mode->rendered ? "true" : "false");
    fprintf(file, "      \"requested_samples\": %d,\n",
            mode->requested_samples);
    fprintf(file, "      \"effective_samples\": %d,\n",
            mode->effective_samples);
    if (!mode->supported) {
        fputs("      \"note\": ", file);
        json_string(file, mode->note);
        fputs("\n    }", file);
        return;
    }
    fprintf(file, "      \"actual_color_samples\": %d,\n",
            mode->actual_color_samples);
    fprintf(file, "      \"actual_depth_samples\": %d,\n",
            mode->actual_depth_samples);
    fprintf(file, "      \"framebuffer_complete\": %s,\n",
            mode->framebuffer_complete ? "true" : "false");
    fprintf(file, "      \"resolve_depth_object_type\": %d,\n",
            mode->resolve_depth_object_type);
    if (!mode->rendered) {
        fputs("      \"note\": \"supported by query but not rendered\",\n",
              file);
        fputs("      \"resolve_depth_attachment_is_none\": false\n    }", file);
        return;
    }
    fprintf(file,
            "      \"attachments\": {\n"
            "        \"color\": {\"type\": \"%s\", \"width\": %d, "
            "\"height\": %d, \"samples\": %d, \"format\": \"GL_RGBA8\", "
            "\"estimated_bytes\": %ld},\n"
            "        \"depth\": {\"type\": \"%s\", \"width\": %d, "
            "\"height\": %d, \"samples\": %d, "
            "\"format\": \"GL_DEPTH_COMPONENT24\", "
            "\"estimated_bytes\": %ld},\n"
            "        \"resolve\": {\"type\": \"texture\", \"width\": %d, "
            "\"height\": %d, \"format\": \"GL_RGBA8\", "
            "\"estimated_bytes\": %ld}\n"
            "      },\n"
            "      \"memory_bytes\": {\"resolve_color\": %ld, "
            "\"color_depth\": %ld, \"total\": %ld},\n"
            "      \"frame_ms_median\": %.6f,\n"
            "      \"edge_band_pixels\": %ld,\n"
            "      \"reference_partial_pixels\": %ld,\n"
            "      \"candidate_partial_pixels\": %ld,\n"
            "      \"partial_ratio\": %.6f,\n"
            "      \"edge_mae\": %.8f,\n"
            "      \"edge_rmse\": %.8f,\n"
            "      \"coverage_mae\": %.8f,\n"
            "      \"coverage_rmse\": %.8f,\n"
            "      \"resolve_depth_attachment_is_none\": %s,\n"
            "      \"image\": ",
            mode->is_multisample ? "multisample renderbuffer"
                                 : "single-sample renderbuffer",
            mode->color_width, mode->color_height, mode->effective_samples,
            mode->color_bytes,
            mode->is_multisample ? "multisample renderbuffer"
                                 : "single-sample renderbuffer",
            mode->depth_width, mode->depth_height, mode->effective_samples,
            mode->depth_bytes,
            mode->resolve_width, mode->resolve_height, mode->resolve_bytes,
            mode->resolve_bytes, mode->color_bytes + mode->depth_bytes,
            mode->total_bytes, mode->frame_ms_median,
            mode->metrics.edge_band_pixels,
            mode->metrics.reference_partial_pixels,
            mode->metrics.candidate_partial_pixels,
            mode->metrics.partial_ratio, mode->metrics.edge_mae,
            mode->metrics.edge_rmse, mode->metrics.coverage_mae,
            mode->metrics.coverage_rmse, mode->depth_safe ? "true" : "false");
    json_string(file, mode->image_path);
    fputs("\n    }", file);
}

static void write_comparison_json(FILE *file, const RenderMode *baseline,
                                  const RenderMode *mode)
{
    fputs("    {\n", file);
    fprintf(file, "      \"mode\": \"x%d\",\n", mode->requested_samples);
    if (!mode->supported || !mode->rendered || !baseline->rendered) {
        fputs("      \"supported\": false,\n", file);
        fputs("      \"status\": \"NOT SUPPORTED - no multisample claim\",\n",
              file);
        fputs("      \"reason\": ", file);
        json_string(file, mode->note[0] ? mode->note
                                        : "comparison unavailable");
        fputs("\n    }", file);
        return;
    }
    long baseline_color_depth =
        baseline->color_bytes + baseline->depth_bytes;
    long mode_color_depth = mode->color_bytes + mode->depth_bytes;
    double mass_reduction =
        baseline->metrics.edge_mae > 0.0
            ? (baseline->metrics.edge_mae - mode->metrics.edge_mae) /
                  baseline->metrics.edge_mae * 100.0
            : 0.0;
    double coverage_reduction =
        baseline->metrics.coverage_mae > 0.0
            ? (baseline->metrics.coverage_mae -
               mode->metrics.coverage_mae) /
                  baseline->metrics.coverage_mae * 100.0
            : 0.0;
    fputs("      \"supported\": true,\n", file);
    fprintf(file, "      \"frame_time_ratio_vs_1x\": %.6f,\n",
            mode->frame_ms_median / baseline->frame_ms_median);
    fprintf(file, "      \"frame_time_delta_ms_vs_1x\": %.6f,\n",
            mode->frame_ms_median - baseline->frame_ms_median);
    fprintf(file, "      \"total_attachment_ratio_vs_1x\": %.6f,\n",
            (double)mode->total_bytes / (double)baseline->total_bytes);
    fprintf(file, "      \"color_depth_memory_ratio_vs_1x\": %.6f,\n",
            (double)mode_color_depth / (double)baseline_color_depth);
    fprintf(file, "      \"extra_total_memory_bytes_vs_1x\": %ld,\n",
            mode->total_bytes - baseline->total_bytes);
    fprintf(file, "      \"edge_mae_ratio_vs_1x\": %.6f,\n",
            mode->metrics.edge_mae / baseline->metrics.edge_mae);
    fprintf(file, "      \"edge_mae_reduction_percent_vs_1x\": %.6f,\n",
            mass_reduction);
    fprintf(file, "      \"coverage_mae_ratio_vs_1x\": %.6f,\n",
            mode->metrics.coverage_mae / baseline->metrics.coverage_mae);
    fprintf(file, "      \"coverage_mae_reduction_percent_vs_1x\": %.6f,\n",
            coverage_reduction);
    fprintf(file, "      \"partial_ratio_vs_reference\": %.6f\n",
            mode->metrics.partial_ratio);
    fputs("    }", file);
}

static int write_report(const char *path, const Renderer *renderer,
                        const RenderMode *modes, int mode_count,
                        const int *rgba_counts, int rgba_count,
                        const int *depth_counts, int depth_count,
                        int max_samples, int max_color_texture_samples,
                        int max_depth_texture_samples)
{
    FILE *file = fopen(path, "w");
    if (!file) {
        perror(path);
        return 0;
    }
    const char *renderer_name = (const char *)glGetString(GL_RENDERER);
    const char *version = (const char *)glGetString(GL_VERSION);
    int depth_safe = 1;
    for (int i = 0; i < mode_count; ++i) {
        if (modes[i].rendered && !modes[i].depth_safe)
            depth_safe = 0;
    }

    fputs("{\n", file);
    fprintf(file,
            "  \"render_target\": {\"width\": %d, \"height\": %d, "
            "\"reference_scale\": %d, \"reference_samples_per_pixel\": %d},\n",
            renderer->width, renderer->height, REFERENCE_SCALE,
            REFERENCE_SCALE * REFERENCE_SCALE);
    fprintf(file, "  \"egl\": \"%d.%d\",\n", renderer->context.major,
            renderer->context.minor);
    fputs("  \"renderer\": ", file);
    json_string(file, renderer_name ? renderer_name : "?");
    fputs(",\n  \"gl_version\": ", file);
    json_string(file, version ? version : "?");
    fputs(",\n", file);
    fputs("  \"reference\": {\"method\": \"4x4 axis supersampling rendered "
          "at 4x resolution and box-filtered to the display size; this is "
          "not hardware MSAA\", \"image\": "
          "\"artifacts/results/reference_supersampled.ppm\"},\n", file);
    fputs("  \"capability\": {\n    \"rgba8_sample_counts\": ", file);
    write_sample_counts(file, rgba_counts, rgba_count);
    fputs(",\n    \"depth24_sample_counts\": ", file);
    write_sample_counts(file, depth_counts, depth_count);
    fprintf(file,
            ",\n    \"gl_max_samples\": %d,\n"
            "    \"max_color_texture_samples\": %d,\n"
            "    \"max_depth_texture_samples\": %d\n"
            "  },\n",
            max_samples, max_color_texture_samples, max_depth_texture_samples);
    fputs("  \"depth_safety\": {\n"
          "    \"status\": ", file);
    json_string(file, depth_safe ? "pass" : "fail");
    fputs(",\n    \"resolve_fbo_depth_attachment\": \"GL_NONE\",\n"
          "    \"resolve_policy\": \"blit GL_COLOR_BUFFER_BIT only; the "
          "multisample depth renderbuffer is attached only to the MSAA FBO "
          "and is never blitted or sampled; presentation disables depth "
          "testing\",\n"
          "    \"single_sample_result_labelled_msaa\": false\n"
          "  },\n", file);
    fputs("  \"modes\": [\n", file);
    for (int i = 0; i < mode_count; ++i) {
        write_mode_json(file, &modes[i]);
        fputs(i + 1 < mode_count ? ",\n" : "\n", file);
    }
    fputs("  ],\n  \"comparisons\": [\n", file);
    int baseline = find_mode(modes, mode_count, 1);
    int emitted = 0;
    for (int i = 0; i < mode_count; ++i) {
        if (i == baseline)
            continue;
        if (emitted++)
            fputs(",\n", file);
        write_comparison_json(file, &modes[baseline], &modes[i]);
    }
    fputs("\n  ],\n  \"x2_vs_x4\": {", file);
    int x2 = find_mode(modes, mode_count, 2);
    int x4 = find_mode(modes, mode_count, 4);
    if (x2 >= 0 && x4 >= 0 && modes[x2].rendered && modes[x4].rendered) {
        fputs("\"available\": true", file);
    } else {
        fputs("\"available\": false, \"reason\": \"2x is not present in the "
              "queried RGBA8/depth24 sample-count lists; no 2x image or "
              "timing is reported\"", file);
    }
    fputs("},\n  \"supported_tier_comparison\": {", file);
    int x8 = find_mode(modes, mode_count, 8);
    if (x4 >= 0 && x8 >= 0 && modes[x4].rendered && modes[x8].rendered) {
        const RenderMode *four = &modes[x4];
        const RenderMode *eight = &modes[x8];
        double edge_reduction =
            (four->metrics.edge_mae - eight->metrics.edge_mae) /
            four->metrics.edge_mae * 100.0;
        double coverage_reduction =
            (four->metrics.coverage_mae - eight->metrics.coverage_mae) /
            four->metrics.coverage_mae * 100.0;
        fprintf(file,
                "\"available\": true, \"lower\": \"x4\", \"higher\": \"x8\", "
                "\"frame_time_ratio_x8_over_x4\": %.6f, "
                "\"total_attachment_ratio_x8_over_x4\": %.6f, "
                "\"color_depth_memory_ratio_x8_over_x4\": %.6f, "
                "\"edge_mae_reduction_percent_x8_over_x4\": %.6f, "
                "\"coverage_mae_reduction_percent_x8_over_x4\": %.6f, "
                "\"partial_ratio_x8_over_x4\": %.6f",
                eight->frame_ms_median / four->frame_ms_median,
                (double)eight->total_bytes / (double)four->total_bytes,
                (double)(eight->color_bytes + eight->depth_bytes) /
                    (double)(four->color_bytes + four->depth_bytes),
                edge_reduction, coverage_reduction,
                eight->metrics.partial_ratio / four->metrics.partial_ratio);
    } else {
        fputs("\"available\": false, \"reason\": \"fewer than two supported "
              "multisample tiers were rendered\"", file);
    }
    fputs("}\n}\n", file);
    int ok = fclose(file) == 0;
    if (!ok)
        fprintf(stderr, "failed to finish %s\n", path);
    return ok;
}

static void ensure_directory(const char *path)
{
    if (mkdir(path, 0755) != 0 && errno != EEXIST)
        perror(path);
}

int main(void)
{
    ensure_directory("artifacts");
    ensure_directory("artifacts/results");

    Renderer renderer;
    if (!renderer_create(&renderer, RENDER_WIDTH, RENDER_HEIGHT)) {
        fprintf(stderr, "renderer initialization failed\n");
        return 1;
    }

    int rgba_counts[64];
    int depth_counts[64];
    int rgba_count = 0;
    int depth_count = 0;
    query_sample_counts(GL_RGBA8, rgba_counts, 64, &rgba_count);
    query_sample_counts(GL_DEPTH_COMPONENT24, depth_counts, 64,
                        &depth_count);
    GLint max_samples = 0;
    GLint max_color_texture_samples = 0;
    GLint max_depth_texture_samples = 0;
    glGetIntegerv(GL_MAX_SAMPLES, &max_samples);
    glGetIntegerv(GL_MAX_COLOR_TEXTURE_SAMPLES, &max_color_texture_samples);
    glGetIntegerv(GL_MAX_DEPTH_TEXTURE_SAMPLES, &max_depth_texture_samples);
    fputs("\n== Multisample capability query "
          "(glGetInternalformativ) ==\n", stdout);
    print_sample_counts("GL_RGBA8", rgba_counts, rgba_count);
    print_sample_counts("GL_DEPTH_COMPONENT24", depth_counts, depth_count);
    printf("GL_MAX_SAMPLES=%d  max color texture samples=%d  "
           "max depth texture samples=%d\n",
           max_samples, max_color_texture_samples,
           max_depth_texture_samples);

    Image reference;
    if (!render_reference(&renderer, &reference)) {
        fprintf(stderr, "reference supersampled render failed\n");
        renderer_destroy(&renderer);
        return 1;
    }
    const char *reference_path =
        "artifacts/results/reference_supersampled.ppm";
    if (!image_write_ppm(reference_path, &reference)) {
        image_free(&reference);
        renderer_destroy(&renderer);
        return 1;
    }
    printf("\nReference: %dx%d 4x4 SSAA (%d samples/pixel)\n",
           reference.width, reference.height,
           REFERENCE_SCALE * REFERENCE_SCALE);

    RenderMode modes[4];
    const int sample_tiers[4] = {1, 2, 4, 8};
    memset(modes, 0, sizeof(modes));
    for (int i = 0; i < 4; ++i) {
        RenderMode *mode = &modes[i];
        if (!mode_create(&renderer, mode, sample_tiers[i])) {
            mode->requested_samples = sample_tiers[i];
            mode->is_multisample = sample_tiers[i] > 1;
            snprintf(mode->note, sizeof(mode->note),
                     "mode creation failed before a complete resolve "
                     "FBO was available");
            fprintf(stderr, "x%d: %s\n", sample_tiers[i], mode->note);
            continue;
        }
        if (!mode->supported) {
            printf("x%d: NOT SUPPORTED - %s\n", sample_tiers[i],
                   mode->note);
            continue;
        }

        mode->frame_ms_median = mode_measure_frame_ms(&renderer, mode);
        snprintf(mode->image_path, sizeof(mode->image_path),
                 "artifacts/results/frame_%s.ppm",
                 mode_tag(sample_tiers[i]));
        Image frame;
        memset(&frame, 0, sizeof(frame));
        int ok = mode_capture(&renderer, mode, &frame);
        if (ok)
            ok = image_write_ppm(mode->image_path, &frame);
        if (ok)
            ok = image_analyze_edges(&reference, &frame, &mode->metrics);
        if (!ok) {
            snprintf(mode->note, sizeof(mode->note),
                     "capture/analysis failed; output is not claimed as a "
                     "valid multisample result");
            fprintf(stderr, "x%d: %s\n", sample_tiers[i], mode->note);
            image_free(&frame);
            continue;
        }
        mode->rendered = 1;
        image_free(&frame);
    }

    fputs("\n== Results table ==\n", stdout);
    fputs("mode     support        eff  attachment        totalKiB   "
          "frameMs    edgeMAE   coverageMAE partialRatio\n", stdout);
    for (int i = 0; i < 4; ++i)
        print_mode_row(&modes[i]);

    int baseline = find_mode(modes, 4, 1);
    if (baseline >= 0 && modes[baseline].rendered) {
        fputs("\nRelative to single-sample baseline "
              "(unsupported tiers are never labelled MSAA):\n", stdout);
        for (int i = 0; i < 4; ++i) {
            if (i == baseline)
                continue;
            const RenderMode *mode = &modes[i];
            if (!mode->supported || !mode->rendered) {
                printf("  x%d: NOT SUPPORTED - no image, memory, or frame "
                       "time reported\n", mode->requested_samples);
                continue;
            }
            const RenderMode *base = &modes[baseline];
            double memory_ratio =
                (double)mode->total_bytes / (double)base->total_bytes;
            double frame_ratio =
                mode->frame_ms_median / base->frame_ms_median;
            double edge_reduction =
                (base->metrics.edge_mae - mode->metrics.edge_mae) /
                base->metrics.edge_mae * 100.0;
            double coverage_reduction =
                (base->metrics.coverage_mae - mode->metrics.coverage_mae) /
                base->metrics.coverage_mae * 100.0;
            printf("  x%d: attachments %.2fx, frame time %.2fx, "
                   "edge MAE -%.1f%%, coverage MAE -%.1f%%, "
                   "partial/reference %.2fx\n",
                   mode->requested_samples, memory_ratio, frame_ratio,
                   edge_reduction, coverage_reduction,
                   mode->metrics.partial_ratio);
        }
    }

    const char *report_path = "artifacts/results/msaa_report.json";
    int report_ok =
        write_report(report_path, &renderer, modes, 4, rgba_counts,
                     rgba_count, depth_counts, depth_count, max_samples,
                     max_color_texture_samples, max_depth_texture_samples);
    image_free(&reference);
    for (int i = 0; i < 4; ++i)
        mode_destroy(&modes[i]);
    renderer_destroy(&renderer);
    if (!report_ok)
        return 1;
    printf("\nWrote %s and frame_*.ppm\n", report_path);
    return 0;
}
