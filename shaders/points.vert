#version 430 core

layout(std430, binding = 0) readonly buffer InstanceBuffer {
    vec4 spheres[];
};

uniform mat4 uViewProjection;

void main() {
    vec4 sphere = spheres[gl_VertexID];
    gl_Position = uViewProjection * vec4(sphere.xyz, 1.0);
    gl_PointSize = 3.0;
}
