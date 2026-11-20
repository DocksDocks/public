# JUnit 5 / Jupiter Conventions

## Contents

- [Detection](#detection)
- [File Layout](#file-layout)
- [Assertion Idioms](#assertion-idioms)
- [Parameterized Tests](#parameterized-tests)
- [Lifecycle](#lifecycle)
- [Nested Tests for Grouping](#nested-tests-for-grouping)
- [Mocking](#mocking)
- [Running](#running)
- [Coverage](#coverage)
- [Common Gotchas](#common-gotchas)
- [Perf Tuning & Parallelism](#perf-tuning-parallelism)
- [Coverage Scope — What NOT to Test](#coverage-scope-what-not-to-test)
- [See Also](#see-also)

Per-framework expansion of the parent SKILL.md. Load when the project's test runner is JUnit 5 (Jupiter) — the JVM standard. Pairs with the universal 6-step procedure and `<constraint>` rules in `../SKILL.md`.

## Detection

| Signal | Confirms JUnit 5 |
|---|---|
| `org.junit.jupiter:junit-jupiter` in `pom.xml` / `build.gradle` | Yes |
| Test classes import `org.junit.jupiter.api.*` | Yes |
| `src/test/java/...` directory tree | Strong signal |
| Tests use `@Test` from Jupiter (NOT `org.junit.Test`) | Yes (JUnit 4 uses the old import) |

## File Layout

```
src/
├── main/java/com/example/users/UserService.java
└── test/java/com/example/users/UserServiceTest.java       # mirror path + "Test" suffix
```

Conventions: test class name = production class name + `Test`. Same package. Maven/Gradle build files manage the classpath split (`src/main` vs `src/test`).

## Assertion Idioms

```java
package com.example.users;

import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class UserServiceTest {

    @Test
    @DisplayName("returns name for known user")
    void returnsName() {
        UserService svc = new UserService(new StubRepo());
        assertEquals("Alice", svc.getName(1L));
    }

    @Test
    void throwsOnUnknownUser() {
        UserService svc = new UserService(new EmptyRepo());
        UserNotFoundException ex = assertThrows(
            UserNotFoundException.class,
            () -> svc.getName(99L)
        );
        assertTrue(ex.getMessage().contains("99"));
    }

    @Test
    void asyncCompletesIn1Second() {
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> {
            new SyncTask().run();
        });
    }
}
```

Core assertions: `assertEquals`, `assertTrue`, `assertNull`, `assertThrows`, `assertAll` (group), `assertTimeout` / `assertTimeoutPreemptively`. AssertJ (`assertThat(actual).isEqualTo(...)`) is a popular fluent alternative.

## Parameterized Tests

```java
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

@ParameterizedTest
@ValueSource(strings = {"1h", "30m", "1h30m"})
void parsesValidDurations(String input) {
    assertNotNull(ParseDuration.parse(input));
}

@ParameterizedTest
@CsvSource({
    "1h,         3600000",
    "30m,        1800000",
    "1h30m,      5400000"
})
void parsesToMs(String input, long expected) {
    assertEquals(expected, ParseDuration.parse(input));
}
```

Requires `org.junit.jupiter:junit-jupiter-params` on the test classpath.

## Lifecycle

```java
class UserServiceTest {

    @BeforeAll                  // once per class (must be static unless TestInstance.PER_CLASS)
    static void setupOnce() { /* expensive setup */ }

    @BeforeEach                 // before each test
    void setup() { /* per-test setup */ }

    @AfterEach
    void teardown() { /* per-test cleanup */ }

    @AfterAll
    static void teardownOnce() { /* expensive teardown */ }
}

// To use non-static @BeforeAll:
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UserServiceTest { /* ... */ }
```

Default lifecycle is `PER_METHOD` — JUnit creates a fresh instance per test, so instance fields don't leak between tests. `PER_CLASS` shares state — convenient but breaks isolation guarantees.

## Nested Tests for Grouping

```java
class UserServiceTest {

    @Nested
    @DisplayName("when user exists")
    class WhenUserExists {
        @Test void returnsName() { /* ... */ }
        @Test void returnsEmail() { /* ... */ }
    }

    @Nested
    @DisplayName("when user does not exist")
    class WhenUserDoesNotExist {
        @Test void throwsNotFound() { /* ... */ }
    }
}
```

## Mocking

Mockito is the de-facto standard:

```java
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock UserRepo repo;
    @InjectMocks UserService svc;

    @Test
    void returnsName() {
        when(repo.find(1L)).thenReturn(Optional.of(new User(1L, "Alice")));
        assertEquals("Alice", svc.getName(1L));
        verify(repo).find(1L);
    }
}
```

For Spring Boot, use `@WebMvcTest`, `@DataJpaTest`, or `@SpringBootTest` with `@MockitoBean` (Spring Framework 6.2+) for the appropriate slice. Spring Boot's `@MockBean` is deprecated since 3.4 and removed in 4.0.

## Running

```bash
# Maven
mvn test                                # All tests
mvn test -Dtest=UserServiceTest         # Single class
mvn test -Dtest=UserServiceTest#returnsName  # Single method

# Gradle
./gradlew test                          # All tests
./gradlew test --tests UserServiceTest
./gradlew test --tests "*returnsName*"
```

## Coverage

JaCoCo is the standard:

```xml
<!-- pom.xml -->
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <executions>
    <execution><goals><goal>prepare-agent</goal></goals></execution>
    <execution><id>report</id><phase>test</phase><goals><goal>report</goal></goals></execution>
  </executions>
</plugin>
```

```bash
mvn test                                # produces target/site/jacoco/index.html
./gradlew test jacocoTestReport         # Gradle
```

For coverage thresholds, add a `check` goal binding with `<rule>` elements (lines, branches, classes).

## Common Gotchas

- **JUnit 4 vs 5 mix-up.** `org.junit.Test` is JUnit 4; `org.junit.jupiter.api.Test` is JUnit 5. Wrong import → test silently skipped or run by wrong engine.
- **Static `@BeforeAll` requirement.** Default `PER_METHOD` lifecycle requires `@BeforeAll` to be `static` — non-static fails at runtime, not compile time.
- **Mockito strict stubbing.** Default behavior of `MockitoExtension` fails the test if a `when(...)` stubbing is unused. Mark with `@MockitoSettings(strictness = Strictness.LENIENT)` or remove the unused stub.
- **`@SpringBootTest` is heavy.** Spins up the full ApplicationContext. Prefer `@WebMvcTest` / `@DataJpaTest` for slice tests.
- **Parallel execution is opt-in** — add `junit.jupiter.execution.parallel.enabled=true` in `junit-platform.properties`. Tests sharing static state will fail when enabled.

## Perf Tuning & Parallelism

The right flags drift across versions — check the JUnit 5 release notes for `junit.jupiter.execution.parallel.*` properties and `mvn help:describe -Dplugin=surefire` (or `./gradlew help --task test`), OR `resolve-library-id` + `query-docs` via context7 to fetch the current docs before tuning.

Stable knobs (recent majors):

```properties
# src/test/resources/junit-platform.properties
junit.jupiter.execution.parallel.enabled=true
junit.jupiter.execution.parallel.mode.default=concurrent
junit.jupiter.execution.parallel.mode.classes.default=concurrent
junit.jupiter.execution.parallel.config.strategy=dynamic
junit.jupiter.execution.parallel.config.dynamic.factor=1.0
```

`@Execution(ExecutionMode.SAME_THREAD)` opts a class/method out of parallelism (use when sharing static state, filesystem temp dirs, or single-thread-only resources).

Surefire (Maven) / Gradle test parallelism:

| Maven Surefire | Gradle | What |
|---|---|---|
| `mvn -T 1C test` | `org.gradle.parallel=true` in `gradle.properties` | Build-level parallelism across modules |
| `<forkCount>1C</forkCount>` in surefire config | `maxParallelForks = ...` | JVM forks (process-level isolation) |
| `<reuseForks>true</reuseForks>` | `forkEvery = 0` | Reuse JVMs across test classes (faster, shared static state) |
| `<argLine>-Xmx2g</argLine>` | `maxHeapSize = "2g"` | Per-fork heap — bump for fixture-heavy tests |

`forkEvery = 100` is a common Gradle pattern — fresh JVM every 100 classes to avoid memory creep without paying JVM-startup cost per class.

Per-machine guidance:
- **Laptop, local iteration:** `./gradlew test --tests "*MyClass*"` — single-class targeting + JVM reuse; the slowest part of JUnit is JVM startup.
- **CI runner with N vCPU:** `maxParallelForks = N`, `forkEvery = 100`, parallel mode `concurrent` for unit tests; the SAME_THREAD class scope for `@SpringBootTest` slices that share static context.
- **DB-sharing tests:** annotate the class `@Execution(SAME_THREAD)` or use `@DirtiesContext` + transactional rollback per test.
- **Memory-constrained:** lower `maxParallelForks` to bound concurrent JVMs (each holds its own heap).

## Coverage Scope — What NOT to Test

```java
// BAD — testing a Lombok @Data DTO; verifies the macro, not your code
@Data
public class UserDto {
    private Long id;
    private String name;
}

// UserDtoTest.java
@Test void equalsAndHashCode() {
    UserDto a = new UserDto(); a.setId(1L); a.setName("x");
    UserDto b = new UserDto(); b.setId(1L); b.setName("x");
    assertEquals(a, b);                 // testing Lombok's generated code, not yours
}
```

```xml
<!-- GOOD — exclude generated/boilerplate from JaCoCo in pom.xml -->
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <executions>
    <execution><goals><goal>prepare-agent</goal></goals></execution>
    <execution><id>check</id><goals><goal>check</goal></goals></execution> <!-- enforces <rules>; binds to verify -->
  </executions>
  <configuration>
    <excludes>
      <exclude>**/dto/*.class</exclude>             <!-- Lombok-heavy DTOs -->
      <exclude>**/generated/**</exclude>            <!-- mapstruct, protoc, openapi -->
      <exclude>**/migration/**</exclude>            <!-- flyway/liquibase Java migrations -->
      <exclude>**/*Application.class</exclude>      <!-- Spring main class -->
      <exclude>**/config/**</exclude>               <!-- Spring @Configuration -->
      <exclude>**/*Properties.class</exclude>       <!-- @ConfigurationProperties -->
    </excludes>
    <rules>
      <rule>
        <element>BUNDLE</element>
        <limits>
          <limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.80</minimum></limit>
        </limits>
      </rule>
    </rules>
  </configuration>
</plugin>
```

JaCoCo filters classes and methods annotated with a CLASS- or RUNTIME-retained annotation whose simple name contains `Generated` — for example `lombok.Generated`, which Lombok adds only when `lombok.addLombokGeneratedAnnotation = true` is set in `lombok.config`. `javax.annotation.Generated` is SOURCE-retained, so JaCoCo does not filter it. For everything else, prefer plugin-level `<excludes>` over scattered annotations so reviewers can see the rule in one place.

## See Also

- `../SKILL.md` — universal 6-step procedure + constraints
- JUnit 5 user guide: https://junit.org/junit5/docs/current/user-guide/
- JUnit 5 parallel-execution docs: https://junit.org/junit5/docs/current/user-guide/#writing-tests-parallel-execution
- Mockito docs: https://site.mockito.org/
- JaCoCo: https://www.jacoco.org/jacoco/
- AssertJ: https://assertj.github.io/doc/
