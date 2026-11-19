"""Tiny pytest-style helpers so the suite runs on the bare stdlib."""

import math


class Approx:
    def __init__(self, value, abs_tol=1e-9):
        self.value = value
        self.abs_tol = abs_tol

    def __eq__(self, other):
        return math.isclose(other, self.value, abs_tol=self.abs_tol)


def approx(value, abs_tol=1e-9):
    return Approx(value, abs_tol)


def raises(exception_type, callable_obj, *args, **kwargs):
    try:
        callable_obj(*args, **kwargs)
    except exception_type as error:
        return error
    raise AssertionError(
        f"{exception_type.__name__} was not raised"
    )
