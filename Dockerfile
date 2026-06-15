# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 OpenAgriOS Contributors

FROM eclipse-temurin:21-jdk-alpine

WORKDIR /app
COPY infra/ ./infra/
COPY core/ ./core/
COPY apps/ ./apps/

RUN mkdir -p target/classes lib && \
    wget -q -O lib/postgresql-42.7.3.jar https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/postgresql-42.7.3.jar && \
    find core apps -name "*.java" > sources.txt && \
    javac -encoding UTF-8 -d target/classes @sources.txt

EXPOSE 8000
CMD ["java", "-Dfile.encoding=UTF-8", "-cp", "lib/*:target/classes", "org.openagrios.apps.agriops.OpenAgriOsServer"]
