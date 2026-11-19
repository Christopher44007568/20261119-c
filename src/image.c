#include "image.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int image_alloc(Image *image, int width, int height)
{
    image->width = width;
    image->height = height;
    image->rgb = calloc((size_t)width * (size_t)height * 3, 1);
    return image->rgb != NULL;
}

void image_free(Image *image)
{
    free(image->rgb);
    image->rgb = NULL;
    image->width = 0;
    image->height = 0;
}

int image_write_ppm(const char *path, const Image *image)
{
    FILE *file = fopen(path, "wb");
    if (!file) {
        perror(path);
        return 0;
    }
    fprintf(file, "P6\n%d %d\n255\n", image->width, image->height);
    size_t bytes = (size_t)image->width * (size_t)image->height * 3;
    int ok = fwrite(image->rgb, 1, bytes, file) == bytes;
    if (fclose(file) != 0)
        ok = 0;
    if (!ok)
        fprintf(stderr, "failed to write %s\n", path);
    return ok;
}

static int ppm_token(FILE *file, char *token, size_t capacity)
{
    int ch;
    size_t length = 0;
    do {
        ch = fgetc(file);
        if (ch == '#') {
            while (ch != '\n' && ch != EOF)
                ch = fgetc(file);
        }
    } while (ch != EOF && isspace(ch));
    if (ch == EOF)
        return 0;
    do {
        if (length + 1 < capacity)
            token[length++] = (char)ch;
        ch = fgetc(file);
    } while (ch != EOF && !isspace(ch));
    token[length] = '\0';
    return length > 0;
}

int image_load_ppm(const char *path, Image *image)
{
    char token[32];
    FILE *file = fopen(path, "rb");
    if (!file) {
        perror(path);
        return 0;
    }
    memset(image, 0, sizeof(*image));
    if (!ppm_token(file, token, sizeof(token)) || strcmp(token, "P6") != 0 ||
        !ppm_token(file, token, sizeof(token))) {
        fprintf(stderr, "%s: not a P6 PPM\n", path);
        fclose(file);
        return 0;
    }
    int width = atoi(token);
    if (!ppm_token(file, token, sizeof(token))) {
        fclose(file);
        return 0;
    }
    int height = atoi(token);
    if (!ppm_token(file, token, sizeof(token)) || atoi(token) != 255 ||
        width <= 0 || height <= 0 || fgetc(file) == EOF ||
        !image_alloc(image, width, height)) {
        fprintf(stderr, "%s: invalid PPM header\n", path);
        fclose(file);
        return 0;
    }
    size_t bytes = (size_t)width * (size_t)height * 3;
    int ok = fread(image->rgb, 1, bytes, file) == bytes;
    fclose(file);
    if (!ok) {
        fprintf(stderr, "%s: truncated PPM payload\n", path);
        image_free(image);
    }
    return ok;
}

static double color_distance2(const unsigned char *a, const unsigned char *b)
{
    double dr = (double)a[0] - b[0];
    double dg = (double)a[1] - b[1];
    double db = (double)a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

static double coverage(const unsigned char *pixel,
                       const unsigned char *background,
                       const unsigned char *foreground)
{
    double vector[3];
    double delta[3];
    double numerator = 0.0;
    double denominator = 0.0;
    for (int channel = 0; channel < 3; ++channel) {
        vector[channel] = (double)foreground[channel] - background[channel];
        delta[channel] = (double)pixel[channel] - background[channel];
        numerator += vector[channel] * delta[channel];
        denominator += vector[channel] * vector[channel];
    }
    if (denominator == 0.0)
        return 0.0;
    double alpha = numerator / denominator;
    if (alpha < 0.0)
        return 0.0;
    if (alpha > 1.0)
        return 1.0;
    return alpha;
}

static int is_partial(const unsigned char *pixel,
                      const unsigned char *background,
                      const unsigned char *foreground)
{
    const double tolerance2 = 9.0;
    return color_distance2(pixel, background) > tolerance2 &&
           color_distance2(pixel, foreground) > tolerance2;
}

int image_analyze_edges(const Image *reference, const Image *candidate,
                        EdgeMetrics *metrics)
{
    if (reference->width != candidate->width ||
        reference->height != candidate->height ||
        reference->width < 2 || reference->height < 2)
        return 0;

    memset(metrics, 0, sizeof(*metrics));
    memcpy(metrics->background, reference->rgb, 3);

    const unsigned char *best = reference->rgb;
    double best_distance = -1.0;
    size_t pixel_count = (size_t)reference->width * reference->height;
    for (size_t i = 0; i < pixel_count; ++i) {
        const unsigned char *pixel = reference->rgb + i * 3;
        double distance = color_distance2(pixel, metrics->background);
        if (distance > best_distance) {
            best_distance = distance;
            best = pixel;
        }
    }
    memcpy(metrics->foreground, best, 3);

    double edge_abs_sum = 0.0;
    double edge_square_sum = 0.0;
    double coverage_abs_sum = 0.0;
    double coverage_square_sum = 0.0;
    for (size_t i = 0; i < pixel_count; ++i) {
        const unsigned char *ref_pixel = reference->rgb + i * 3;
        const unsigned char *cand_pixel = candidate->rgb + i * 3;
        int ref_partial = is_partial(ref_pixel, metrics->background,
                                     metrics->foreground);
        int cand_partial = is_partial(cand_pixel, metrics->background,
                                      metrics->foreground);
        if (cand_partial)
            ++metrics->candidate_partial_pixels;
        if (!ref_partial)
            continue;

        ++metrics->edge_band_pixels;
        for (int channel = 0; channel < 3; ++channel) {
            double error = ((double)cand_pixel[channel] -
                            (double)ref_pixel[channel]) / 255.0;
            edge_abs_sum += fabs(error);
            edge_square_sum += error * error;
        }
        double ref_coverage = coverage(ref_pixel, metrics->background,
                                       metrics->foreground);
        double cand_coverage = coverage(cand_pixel, metrics->background,
                                        metrics->foreground);
        double coverage_error = cand_coverage - ref_coverage;
        coverage_abs_sum += fabs(coverage_error);
        coverage_square_sum += coverage_error * coverage_error;
    }

    metrics->reference_partial_pixels = metrics->edge_band_pixels;
    if (metrics->edge_band_pixels > 0) {
        size_t samples = (size_t)metrics->edge_band_pixels * 3;
        metrics->edge_mae = edge_abs_sum / (double)samples;
        metrics->edge_rmse = sqrt(edge_square_sum / (double)samples);
        metrics->coverage_mae =
            coverage_abs_sum / (double)metrics->edge_band_pixels;
        metrics->coverage_rmse =
            sqrt(coverage_square_sum / (double)metrics->edge_band_pixels);
    }
    if (metrics->reference_partial_pixels > 0) {
        metrics->partial_ratio =
            (double)metrics->candidate_partial_pixels /
            (double)metrics->reference_partial_pixels;
    }
    return metrics->edge_band_pixels > 0;
}
