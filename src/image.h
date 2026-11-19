#ifndef IMAGE_H
#define IMAGE_H

typedef struct {
    int width;
    int height;
    unsigned char *rgb;
} Image;

typedef struct {
    long edge_band_pixels;
    long reference_partial_pixels;
    long candidate_partial_pixels;
    double partial_ratio;
    double edge_mae;
    double edge_rmse;
    double coverage_mae;
    double coverage_rmse;
    unsigned char background[3];
    unsigned char foreground[3];
} EdgeMetrics;

int image_alloc(Image *image, int width, int height);
void image_free(Image *image);
int image_write_ppm(const char *path, const Image *image);
int image_load_ppm(const char *path, Image *image);
int image_analyze_edges(const Image *reference, const Image *candidate,
                        EdgeMetrics *metrics);

#endif
