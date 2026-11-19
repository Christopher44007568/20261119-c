"""Exact geometric predicates with a floating-point filter.

The fast path evaluates the determinant in double precision and trusts it
when its magnitude clearly exceeds a conservative error bound.  Near-zero
results (near-collinear / near-cocircular inputs) fall back to exact
rational arithmetic, which is always possible because doubles convert
exactly to Fraction.
"""

from fractions import Fraction

# Conservative relative error bound for the float fast path.  Double
# precision gives ~1e-16 per operation; 1e-12 is a wide safety margin.
_EPS = 1e-12


def _sign(x):
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0


def orient2d(a, b, c):
    """Sign of the orient predicate: +1 if c is left of directed edge a->b,
    -1 if right, 0 if exactly collinear."""
    acx = a[0] - c[0]
    acy = a[1] - c[1]
    bcx = b[0] - c[0]
    bcy = b[1] - c[1]
    det = acx * bcy - acy * bcx
    permanent = (abs(acx) + abs(bcx)) * (abs(acy) + abs(bcy))
    if det > _EPS * permanent:
        return 1
    if det < -_EPS * permanent:
        return -1
    # Exact fallback.
    eax = Fraction(a[0]) - Fraction(c[0])
    eay = Fraction(a[1]) - Fraction(c[1])
    ebx = Fraction(b[0]) - Fraction(c[0])
    eby = Fraction(b[1]) - Fraction(c[1])
    return _sign(eax * eby - eay * ebx)


def incircle(a, b, c, d):
    """Sign of the incircle predicate for CCW triangle (a, b, c):
    +1 if d is strictly inside the circumcircle, -1 outside, 0 cocircular."""
    adx = a[0] - d[0]
    ady = a[1] - d[1]
    bdx = b[0] - d[0]
    bdy = b[1] - d[1]
    cdx = c[0] - d[0]
    cdy = c[1] - d[1]
    abdet = adx * bdy - bdx * ady
    bcdet = bdx * cdy - cdx * bdy
    cadet = cdx * ady - adx * cdy
    alift = adx * adx + ady * ady
    blift = bdx * bdx + bdy * bdy
    clift = cdx * cdx + cdy * cdy
    det = alift * bcdet + blift * cadet + clift * abdet
    permanent = (
        (abs(bdx * cdy) + abs(cdx * bdy)) * alift
        + (abs(cdx * ady) + abs(adx * cdy)) * blift
        + (abs(adx * bdy) + abs(bdx * ady)) * clift
    )
    if det > _EPS * permanent:
        return 1
    if det < -_EPS * permanent:
        return -1
    # Exact fallback.
    eax = Fraction(a[0]) - Fraction(d[0])
    eay = Fraction(a[1]) - Fraction(d[1])
    ebx = Fraction(b[0]) - Fraction(d[0])
    eby = Fraction(b[1]) - Fraction(d[1])
    ecx = Fraction(c[0]) - Fraction(d[0])
    ecy = Fraction(c[1]) - Fraction(d[1])
    eab = eax * eby - ebx * eay
    ebc = ebx * ecy - ecx * eby
    eca = ecx * eay - eax * ecy
    eal = eax * eax + eay * eay
    ebl = ebx * ebx + eby * eby
    ecl = ecx * ecx + ecy * ecy
    return _sign(eal * ebc + ebl * eca + ecl * eab)
