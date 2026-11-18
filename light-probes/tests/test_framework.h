#pragma once

#include <cmath>
#include <functional>
#include <iostream>
#include <string>
#include <vector>

namespace lp_test {

struct TestCase {
    std::string name;
    std::function<void()> fn;
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> cases;
    return cases;
}

struct Registrar {
    Registrar(const std::string& name, std::function<void()> fn) {
        registry().push_back({name, std::move(fn)});
    }
};

inline bool nearlyEqual(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps * (1.0f + std::max(std::fabs(a),
                                                       std::fabs(b)));
}

#define LP_TEST(name)                                                     \
    static void name();                                                   \
    static ::lp_test::Registrar registrar_##name(#name, name);            \
    static void name()

#define LP_CHECK(cond)                                                    \
    do {                                                                  \
        if (!(cond)) {                                                    \
            throw std::runtime_error(std::string("check failed: ") +      \
                                     #cond + " (" + __FILE__ + ":" +      \
                                     std::to_string(__LINE__) + ")");     \
        }                                                                 \
    } while (0)

#define LP_CHECK_NEAR(a, b)                                               \
    do {                                                                  \
        float lpA = (a);                                                  \
        float lpB = (b);                                                  \
        if (!::lp_test::nearlyEqual(lpA, lpB)) {                          \
            throw std::runtime_error(                                     \
                std::string("near check failed: ") + #a " ~= " #b +       \
                " got " + std::to_string(lpA) + " vs " +                  \
                std::to_string(lpB) + " (" + __FILE__ + ":" +             \
                std::to_string(__LINE__) + ")");                          \
        }                                                                 \
    } while (0)

inline int runAll() {
    int failed = 0;
    for (const TestCase& test : registry()) {
        try {
            test.fn();
            std::cout << "[ PASS ] " << test.name << "\n";
        } catch (const std::exception& error) {
            ++failed;
            std::cout << "[ FAIL ] " << test.name << ": " << error.what()
                      << "\n";
        }
    }
    std::cout << registry().size() - failed << "/" << registry().size()
              << " tests passed\n";
    return failed == 0 ? 0 : 1;
}

} // namespace lp_test
