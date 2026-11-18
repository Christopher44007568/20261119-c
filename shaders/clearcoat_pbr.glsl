// Clearcoat PBR (dual-layer) BRDF.
//
// Layer model
//   Base layer : metallic-roughness GGX. `baseColor` + `metallic` drive the
//                diffuse term and the base specular F0.
//   Clearcoat  : dielectric GGX lobe on top. Controlled by `clearcoat` (weight),
//                `clearcoatRoughness`, `clearcoatIOR` and `clearcoatThickness`
//                (Beer-Lambert absorption of the base layer through the coat).
//
// Energy conservation
//   Light reaching the base layer crosses the coat interface twice (in and
//   out), so the base contribution is scaled by (1 - Fc)^2 * absorption,
//   where Fc = clearcoat * F_coat(NoH). The coat lobe itself is scaled by
//   `clearcoat`, so setting clearcoat = 0 makes Fc = 0, the attenuation 1,
//   and the result reduces exactly to the plain base-layer BRDF.
//   The two lobes are never both added at full strength: the coat's Fresnel
//   reflection is subtracted from the energy that reaches the base.

#ifndef CLEARCOAT_PBR_GLSL
#define CLEARCOAT_PBR_GLSL

const float CC_PI = 3.14159265358979323846;

struct ClearcoatMaterial
{
    vec3  baseColor;           // albedo of the base layer
    float metallic;            // base layer metallic [0,1]
    float roughness;           // base layer perceptual roughness [0,1]
    float clearcoat;           // clearcoat weight [0,1]
    float clearcoatRoughness;  // clearcoat perceptual roughness [0,1]
    float clearcoatIOR;        // clearcoat index of refraction (e.g. 1.5)
    float clearcoatThickness;  // coat thickness, drives absorption
    vec3  clearcoatAbsorption; // absorption coefficient (sigma) of the coat
};

// Per-layer reflection terms, recorded so callers can inspect how the
// energy is split instead of blindly summing two full lobes.
struct ClearcoatTerms
{
    vec3  baseDiffuse;       // base Lambert diffuse   (pre-attenuation)
    vec3  baseSpecular;      // base GGX specular      (pre-attenuation)
    vec3  coatSpecular;      // clearcoat GGX lobe (already weight-scaled)
    float coatFresnel;       // Fc = clearcoat * F_coat(NoH)
    float layerAttenuation;  // (1 - Fc)^2 applied to the base layer
    vec3  absorption;        // Beer-Lambert tint from coat thickness
    vec3  baseThroughCoat;   // attenuated base total actually added
    vec3  total;             // final combined BRDF * NoL
};

// ---------------------------------------------------------------------------
// Microfacet building blocks
// ---------------------------------------------------------------------------

float cc_D_GGX(float NoH, float roughness)
{
    float a  = roughness * roughness;
    float a2 = a * a;
    float d  = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / (CC_PI * d * d);
}

// Smith correlated visibility term (height-correlated GGX, Hammon form).
float cc_V_SmithGGXCorrelated(float NoV, float NoL, float roughness)
{
    float a2 = roughness * roughness;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-6);
}

vec3 cc_F_Schlick(vec3 f0, float VoH)
{
    float t = clamp(1.0 - VoH, 0.0, 1.0);
    float t2 = t * t;
    float t5 = t2 * t2 * t;
    return f0 + (vec3(1.0) - f0) * t5;
}

// Exact dielectric F0 from index of refraction.
float cc_F0FromIOR(float ior)
{
    float r = (ior - 1.0) / (ior + 1.0);
    return r * r;
}

// ---------------------------------------------------------------------------
// Layer evaluation
// ---------------------------------------------------------------------------

// Base layer BRDF (diffuse + specular), without any coat attenuation.
void cc_evalBase(ClearcoatMaterial m, float NoV, float NoL, float NoH, float VoH,
                 out vec3 diffuse, out vec3 specular)
{
    vec3 f0 = mix(vec3(0.04), m.baseColor, m.metallic);

    vec3  fd = (1.0 - m.metallic) * m.baseColor / CC_PI;

    float d  = cc_D_GGX(NoH, m.roughness);
    float v  = cc_V_SmithGGXCorrelated(NoV, NoL, m.roughness);
    vec3  f  = cc_F_Schlick(f0, VoH);
    vec3  fs = d * v * f;

    // Diffuse loses the energy taken by the base specular Fresnel.
    diffuse  = fd * (vec3(1.0) - f);
    specular = fs;
}

// Clearcoat lobe: dielectric GGX scaled by the coat weight.
// Returns the BRDF value and outputs Fc (weight-scaled Fresnel at NoH),
// which is the fraction of energy the coat reflects away from the base.
vec3 cc_evalCoat(ClearcoatMaterial m, float NoV, float NoL, float NoH, float VoH,
                 out float Fc)
{
    float f0 = cc_F0FromIOR(m.clearcoatIOR);

    float d = cc_D_GGX(NoH, m.clearcoatRoughness);
    float v = cc_V_SmithGGXCorrelated(NoV, NoL, m.clearcoatRoughness);
    float f = cc_F_Schlick(vec3(f0), VoH).x;

    Fc = m.clearcoat * f;
    return vec3(m.clearcoat * d * v * f);
}

// Beer-Lambert absorption through the coat, traversed twice (in + out).
vec3 cc_coatAbsorption(ClearcoatMaterial m, float NoV, float NoL)
{
    vec3 path = m.clearcoatThickness * (1.0 / max(NoV, 1e-4)
                                      + 1.0 / max(NoL, 1e-4));
    return exp(-m.clearcoatAbsorption * path);
}

// Full dual-layer BRDF for one light direction.
// N, V, L must be normalized; returns BRDF * NoL and records all layer terms.
vec3 cc_evaluate(ClearcoatMaterial m, vec3 N, vec3 V, vec3 L,
                 out ClearcoatTerms terms)
{
    vec3  H   = normalize(V + L);
    float NoV = clamp(dot(N, V), 1e-4, 1.0);
    float NoL = clamp(dot(N, L), 0.0, 1.0);
    float NoH = clamp(dot(N, H), 0.0, 1.0);
    float VoH = clamp(dot(V, H), 0.0, 1.0);

    // Clearcoat lobe (top interface).
    float Fc;
    terms.coatSpecular = cc_evalCoat(m, NoV, NoL, NoH, VoH, Fc);
    terms.coatFresnel  = Fc;

    // Base layer (bottom interface).
    cc_evalBase(m, NoV, NoL, NoH, VoH, terms.baseDiffuse, terms.baseSpecular);

    // Energy handed down to the base: light crosses the coat twice, and the
    // coat never *covers* the base color -- it only removes the Fresnel
    // fraction Fc per traversal and tints it by thickness absorption.
    // Absorption is gated on the coat weight so that clearcoat = 0 always
    // reduces exactly to the uncoated base layer.
    terms.layerAttenuation = (1.0 - Fc) * (1.0 - Fc);
    terms.absorption       = mix(vec3(1.0), cc_coatAbsorption(m, NoV, NoL),
                                 m.clearcoat);
    terms.baseThroughCoat  = (terms.baseDiffuse + terms.baseSpecular)
                           * terms.layerAttenuation * terms.absorption;

    terms.total = (terms.baseThroughCoat + terms.coatSpecular) * NoL;
    return terms.total;
}

#endif // CLEARCOAT_PBR_GLSL
