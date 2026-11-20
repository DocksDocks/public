# Kotlin — Value Classes + Sealed Types

## Contents

- [Value classes for ID safety (Kotlin 1.5+)](#value-classes-for-id-safety-kotlin-15)
  - [Validated value class](#validated-value-class)
- [Sealed interfaces for tagged unions](#sealed-interfaces-for-tagged-unions)
  - [Exhaustive `when`](#exhaustive-when)
- [Parse-don't-validate with kotlinx.serialization](#parse-dont-validate-with-kotlinxserialization)
- [Smart-cast over unchecked cast](#smart-cast-over-unchecked-cast)
- [Avoid](#avoid)
- [References](#references)

Deep examples for the patterns referenced in the main `SKILL.md`. Read this when working in a Kotlin codebase.

## Value classes for ID safety (Kotlin 1.5+)

```kotlin
@JvmInline
value class UserId(val value: String)

@JvmInline
value class OrgId(val value: String)

fun loadUser(id: UserId) { /* ... */ }

val orgId = OrgId("...")
loadUser(orgId)  // ✗ compile error
```

`@JvmInline` makes the wrapper free at the JVM bytecode level — the underlying `String` is passed without boxing — while the Kotlin type system treats `UserId` and `OrgId` as distinct.

### Validated value class

When the wrapped value must satisfy a constraint:

```kotlin
@JvmInline
value class Email private constructor(val value: String) {
    companion object {
        fun parse(raw: String): Result<Email> =
            if (raw.contains('@')) Result.success(Email(raw))
            else Result.failure(IllegalArgumentException("Missing @"))
    }
}
```

The `private constructor` forces callers through the validated factory.

## Sealed interfaces for tagged unions

```kotlin
sealed interface Invite {
    data class User(val id: UserId) : Invite
    data class Guest(val email: String, val name: String) : Invite
}

fun send(invite: Invite) = when (invite) {
    is Invite.User -> sendToUser(invite.id)
    is Invite.Guest -> sendToGuest(invite.email, invite.name)
}
```

`sealed` permits direct subclasses anywhere in the same package and module (Kotlin 1.5+; multiplatform projects also require the same source set). Kotlin 1.7+ checks exhaustiveness for `when` over sealed, enum, and Boolean subjects in both expression and statement form.

### Exhaustive `when`

```kotlin
// EXHAUSTIVE — Kotlin 1.7+ checks this sealed-subject expression
val message = when (invite) {
    is Invite.User -> "Sent to user ${invite.id.value}"
    is Invite.Guest -> "Sent to ${invite.email}"
}

// ALSO EXHAUSTIVE — sealed-subject statements are compile-checked in Kotlin 1.7+
when (invite) {
    is Invite.User -> sendToUser(invite.id)
    is Invite.Guest -> sendToGuest(invite.email, invite.name)
}

// NOT EXHAUSTIVENESS-CHECKED — String is an open-ended subject
val status: String = readStatus()
when (status) {
    "ready" -> start()
}
```

On Kotlin 1.7+, statement form is safe for sealed, enum, and Boolean subjects. For open-ended subjects such as `String`, use expression form with `else` when every path must produce a value.

## Parse-don't-validate with kotlinx.serialization

```kotlin
@Serializable
data class Config(
    val apiKey: String,
    val port: Int,
)

val config: Config = Json.decodeFromString(raw)
```

Or with Jackson for JVM-only projects:

```kotlin
val config: Config = ObjectMapper()
    .registerModule(KotlinModule.Builder().build())
    .readValue(raw)
```

Both throw on shape mismatch — no `as` casts.

## Smart-cast over unchecked cast

```kotlin
// BAD — unchecked, throws at runtime if wrong
val s = value as String

// GOOD — smart-cast via `is`
if (value is String) {
    println(value.length)  // value is smart-cast to String here
}

// SAFE — `as?` returns null on failure
val s = value as? String  // String?
```

## Avoid

- **`as` unchecked casts** — throw `ClassCastException` at runtime. Use `is` smart-casts or `as?`.
- **`Any?`** for anything other than truly heterogeneous collections. Use sealed types.
- **`lateinit var`** as an escape hatch — throws on access if unset. Prefer constructor injection.
- **String typing for IDs** — wrap with value classes.

## References

- Kotlin docs — inline value classes: https://kotlinlang.org/docs/inline-classes.html
- Kotlin docs — sealed classes and interfaces: https://kotlinlang.org/docs/sealed-classes.html
- kotlinx.serialization: https://github.com/Kotlin/kotlinx.serialization
