# PassVaultify sync server. Build from apps/server:
#   docker build -t passvaultify-server .
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY src src
RUN ./mvnw -B -q package -DskipTests

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 --home-dir /data passvaultify \
  && mkdir -p /data && chown passvaultify /data
COPY --from=build /src/target/passvaultify-server.jar /app/passvaultify-server.jar
USER passvaultify
ENV PASSVAULTIFY_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/passvaultify-server.jar"]
