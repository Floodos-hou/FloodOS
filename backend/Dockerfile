FROM eclipse-temurin:21-jdk-alpine

WORKDIR /app
COPY infra/ ./infra/
COPY backend/ ./backend/

RUN mkdir -p backend/target/classes && \
    find backend/src/main/java -name "*.java" > sources.txt && \
    javac -encoding UTF-8 -d backend/target/classes @sources.txt

EXPOSE 8000
CMD ["java", "-Dfile.encoding=UTF-8", "-cp", "backend/target/classes", "org.openagrios.OpenAgriOsServer"]
