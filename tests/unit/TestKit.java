// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

import java.util.ArrayList;
import java.util.List;

/**
 * Minimal dependency-free unit-test harness (the core deliberately has no third-party build dependencies).
 * Each {@link #test} runs immediately, isolates failures, and {@link #report()} yields the process exit code.
 */
public final class TestKit {

    public interface Body {
        void run() throws Exception;
    }

    private record Result(String suite, String name, Throwable error) {}

    private static final List<Result> RESULTS = new ArrayList<>();
    private static String currentSuite = "";

    private TestKit() {}

    public static void suite(String name) {
        currentSuite = name;
        System.out.println("\n== " + name);
    }

    public static void test(String name, Body body) {
        try {
            body.run();
            RESULTS.add(new Result(currentSuite, name, null));
            System.out.println("  [ok]   " + name);
        } catch (Throwable t) {
            RESULTS.add(new Result(currentSuite, name, t));
            System.out.println("  [FAIL] " + name + "\n         -> " + t);
        }
    }

    public static void isTrue(boolean cond, String msg) {
        if (!cond) throw new AssertionError(msg);
    }

    public static void isFalse(boolean cond, String msg) {
        if (cond) throw new AssertionError(msg);
    }

    public static void equal(Object expected, Object actual, String msg) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(msg + " | expected=<" + expected + "> actual=<" + actual + ">");
        }
    }

    public static void near(double expected, double actual, double eps, String msg) {
        if (Math.abs(expected - actual) > eps) {
            throw new AssertionError(msg + " | expected=" + expected + " actual=" + actual + " eps=" + eps);
        }
    }

    public static void isNull(Object o, String msg) {
        if (o != null) throw new AssertionError(msg + " | actual=<" + o + ">");
    }

    public static void notNull(Object o, String msg) {
        if (o == null) throw new AssertionError(msg);
    }

    public static void contains(String haystack, String needle, String msg) {
        if (haystack == null || !haystack.contains(needle)) {
            throw new AssertionError(msg + " | missing=<" + needle + "> in=<" + haystack + ">");
        }
    }

    public static <T extends Throwable> T throwsA(Class<T> type, Body body, String msg) {
        try {
            body.run();
        } catch (Throwable t) {
            if (type.isInstance(t)) return type.cast(t);
            throw new AssertionError(msg + " | expected " + type.getSimpleName() + " but got " + t, t);
        }
        throw new AssertionError(msg + " | expected " + type.getSimpleName() + " but nothing was thrown");
    }

    /** Polls until the condition holds (for the asynchronous publisher); fails after the timeout. */
    public static void eventually(long timeoutMs, java.util.function.BooleanSupplier cond, String msg) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (cond.getAsBoolean()) return;
            Thread.sleep(25);
        }
        throw new AssertionError("timeout after " + timeoutMs + "ms: " + msg);
    }

    /** Prints the summary and returns the exit code (0 = all green). */
    public static int report() {
        long failed = RESULTS.stream().filter(r -> r.error() != null).count();
        System.out.println("\n============================================================================");
        System.out.printf("UNIT TESTS: %d run, %d passed, %d failed%n", RESULTS.size(), RESULTS.size() - failed, failed);
        RESULTS.stream().filter(r -> r.error() != null).forEach(r ->
                System.out.println("  FAILED: [" + r.suite() + "] " + r.name() + " -> " + r.error()));
        System.out.println("============================================================================");
        return failed == 0 ? 0 : 1;
    }
}
