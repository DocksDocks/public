# Swift guardrails

## Contents

- [Detect](#detect)
- [Recommended config](#recommended-config)
- [Rules that catch raw values](#rules-that-catch-raw-values)
- [Constant map](#constant-map)
- [Verify](#verify)
- [Sources](#sources)

## Detect

- Find `.swiftlint.yml` before changing lint rules.
- Check `Package.swift` for `SwiftLintBuildToolPlugin` or a SwiftLint package command plugin.
- Check Xcode targets for a SwiftLint build tool plugin or a Run Script phase.
- Find `.swift-format` if the project uses `swift-format`. Treat formatting as layout work, not lint coverage.
- Run `command -v swiftlint` before proposing SwiftLint changes. Ask before installing it when absent.

## Recommended config

Merge this `.swiftlint.yml` example into the existing file. Keep existing rules and stricter settings.
Add only missing opt-in rules. Keep `disabled_rules` untouched and report any conflict before changing it.
Keep other config keys, including file scope and analyzer settings. Do not replace the file with this example.

```yaml
opt_in_rules:
  - no_magic_numbers
  - force_unwrapping
  - implicitly_unwrapped_optional
  - fatal_error_message
  - no_empty_block
  - unhandled_throwing_task

no_magic_numbers:
  severity: error
  allowed_numbers: [0.0, 1.0]
force_unwrapping:
  severity: error
  ignored_literal_argument_functions: []
implicitly_unwrapped_optional:
  severity: error
fatal_error_message:
  severity: error
no_empty_block:
  severity: error
unhandled_throwing_task:
  severity: error
force_cast:
  severity: error
force_try:
  severity: error
```

`force_cast` and `force_try` are default rules with error severity.
Keep them enabled at error severity; report any existing override that weakens or disables them.
`no_magic_numbers` permits `0.0`, `1.0`, and `100.0` by default; the example removes `100.0` from that allowance.
SwiftLint always skips test code for this rule: `XCTestCase` and `QuickSpec` subclasses, `@Test` functions, and `@Suite` types.
No setting turns the rule on there, because the rule adds these classes to `test_parent_classes` itself.
For Swift tests, run [Find scattered values](../SKILL.md#find-scattered-values); it includes test files.
In tests, use production constants for inputs and a named `let` for each expected literal.

## Rules that catch raw values

| Rule | Catches | Limits |
|---|---|---|
| [`no_magic_numbers`](https://realm.github.io/SwiftLint/no_magic_numbers.html) | Raw numeric expressions, such as an array index or limit. | It excludes declarations, default allowed values, and all test code. It does not check repeated strings. |
| [`force_unwrapping`](https://realm.github.io/SwiftLint/force_unwrapping.html) | Forced optional unwraps. | The example removes its default literal-initializer exceptions. It does not find raw values. |
| [`implicitly_unwrapped_optional`](https://realm.github.io/SwiftLint/implicitly_unwrapped_optional.html) | Implicitly unwrapped optional types. | Its default mode excludes outlets; it does not find raw values. |
| [`fatal_error_message`](https://realm.github.io/SwiftLint/fatal_error_message.html) | Missing or empty failure messages. | It does not judge message content or find raw values. |
| [`no_empty_block`](https://realm.github.io/SwiftLint/no_empty_block.html) | Empty code blocks. | A comment counts as content; it does not find raw values. |
| [`unhandled_throwing_task`](https://realm.github.io/SwiftLint/unhandled_throwing_task.html) | Unhandled errors in discarded throwing tasks. | It does not find raw values. |
| [`force_cast`](https://realm.github.io/SwiftLint/force_cast.html) and [`force_try`](https://realm.github.io/SwiftLint/force_try.html) | Forced casts and forced throwing calls. | Both default to error severity; neither finds raw values. |
| No SwiftLint rule here | Repeated strings, paths, keys, and unit mismatches. | Use [Find scattered values](../SKILL.md#find-scattered-values) and review ownership. |

## Constant map

Put constants in the module that owns each policy. Use a caseless `enum` with `static let` values when no instances are needed.
Name units in scalar constants. Derive larger units from smaller ones. Use `Duration` for elapsed time and `Measurement` for physical quantities when their types fit.
Import the owning module at call sites instead of copying values.

```swift
// BAD — repeated numbers and keys hide units and policy ownership.
func upload(_ body: Data) {
    guard body.count <= 8 * 1_024 * 1_024 else { return }
    save(body, key: "upload.limit", timeout: .seconds(30))
}

// GOOD — one owner names units and derives related values.
enum UploadPolicy {
    static let kibBytes = 1_024
    static let mibBytes = 1_024 * kibBytes
    static let maxBodyBytes = 8 * mibBytes
    static let limitKey = "upload.limit"
    static let timeout: Duration = .seconds(30)
}

func upload(_ body: Data) {
    guard body.count <= UploadPolicy.maxBodyBytes else { return }
    save(body, key: UploadPolicy.limitKey, timeout: UploadPolicy.timeout)
}
```

## Verify

- Run `swiftlint lint --strict` from the directory with `.swiftlint.yml`.
- Check each new rule for violations and report every config change.
- Report unhandled repeated values from [Find scattered values](../SKILL.md#find-scattered-values).
- If SwiftLint is absent, ask before installing it; do not claim the lint check passed.

## Sources

- SwiftLint [configuration, command usage, and plugins](https://github.com/realm/SwiftLint/blob/main/README.md) and [rule directory](https://realm.github.io/SwiftLint/rule-directory.html).
- SwiftLint rules: [no_magic_numbers](https://realm.github.io/SwiftLint/no_magic_numbers.html), [force_unwrapping](https://realm.github.io/SwiftLint/force_unwrapping.html), [implicitly_unwrapped_optional](https://realm.github.io/SwiftLint/implicitly_unwrapped_optional.html).
- SwiftLint rules: [fatal_error_message](https://realm.github.io/SwiftLint/fatal_error_message.html), [no_empty_block](https://realm.github.io/SwiftLint/no_empty_block.html), [unhandled_throwing_task](https://realm.github.io/SwiftLint/unhandled_throwing_task.html).
- SwiftLint rules: [force_cast](https://realm.github.io/SwiftLint/force_cast.html), [force_try](https://realm.github.io/SwiftLint/force_try.html).
- Swift-format [configuration discovery](https://github.com/swiftlang/swift-format/blob/main/README.md#configuring-the-command-line-tool); Swift [Duration](https://developer.apple.com/documentation/swift/duration) and Foundation [Measurement](https://developer.apple.com/documentation/foundation/measurement).
