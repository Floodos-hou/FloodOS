// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.tests.unit;

/**
 * Entry point of the dependency-free unit suite:
 * {@code java -cp target/classes org.floodos.tests.unit.UnitTestRunner}. Exit code 0 = all green.
 */
public final class UnitTestRunner {

    private UnitTestRunner() {}

    public static void main(String[] args) throws Exception {
        PureLogicTests.run();
        SecurityTests.run();
        PlatformTests.run();
        ScannerTests.run();
        System.exit(TestKit.report());
    }
}
