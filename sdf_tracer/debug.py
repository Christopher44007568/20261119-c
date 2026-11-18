"""Human-readable debug output for individual traced rays."""


def format_report(pixel, ray, result, validation):
    origin, direction = ray
    lines = []
    lines.append("=" * 72)
    lines.append("DEBUG RAY pixel=(%d,%d)" % pixel)
    lines.append("  origin    = (%.4f, %.4f, %.4f)" % origin)
    lines.append("  direction = (%.4f, %.4f, %.4f)" % direction)
    lines.append("  termination reason : %s" % result["reason"])
    lines.append("  total distance t   : %.6f" % result["t"])
    lines.append("  steps taken        : %d" % result["steps"])
    lines.append("  min |sdf distance| : %.6e" % result["min_distance"])
    lines.append("-" * 72)
    lines.append("  step |   t (along ray) | signed dist |   step size")
    if result["trace"]:
        for step, t, dist, step_size in result["trace"]:
            lines.append("  %4d | %15.6f | %11.6f | %12.6f"
                         % (step, t, dist, step_size))
    lines.append("-" * 72)
    lines.append("  analytic sphere validation")
    lines.append("    marched t  : %s"
                 % _fmt(validation["marched_t"]))
    lines.append("    analytic t : %s"
                 % _fmt(validation["analytic_t"]))
    lines.append("    delta      : %s (marched - analytic)"
                 % _fmt(validation["delta"]))
    lines.append("    within bound: %s" % validation["within_bound"])
    lines.append("=" * 72)
    return "\n".join(lines)


def _fmt(value):
    return "n/a" if value is None else "%.6f" % value


def print_reports(debug_reports):
    for pixel, ray, result, validation in debug_reports:
        print(format_report(pixel, ray, result, validation))


def write_reports(path, debug_reports):
    with open(path, "w") as fh:
        for pixel, ray, result, validation in debug_reports:
            fh.write(format_report(pixel, ray, result, validation))
            fh.write("\n\n")
