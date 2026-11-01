// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

/**
 * Entry point of the dependency-free unit suite:
 * {@code java -cp target/classes org.openagrios.tests.unit.UnitTestRunner}. Exit code 0 = all green.
 */
public final class UnitTestRunner {

    private UnitTestRunner() {}

    public static void main(String[] args) throws Exception {
        PureLogicTests.run();
        SecurityTests.run();
        PlatformTests.run();
        System.exit(TestKit.report());
    }
}
