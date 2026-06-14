## ADDED Requirements

### Requirement: TemplateApiError unified onto ApiError

The template REST client (`reader-src/src/lib/template-api.ts`) SHALL route its error handling through the shared `ApiError`. `TemplateApiError` SHALL be a subclass of `ApiError` (or, when its fields align 1:1 and no consumer constructs a separate instance to test `instanceof TemplateApiError`, an alias of `ApiError`), preserving every consumer-visible public field name it exposes today. Template calls SHALL use the default-throwing `apiFetch` (no `throwOnError: false` opt-out) so non-2xx responses surface as `ApiError`/`TemplateApiError` instances, and the bespoke `parseError` helper SHALL be deleted. Template-editor consumers that catch template errors SHALL continue to work unchanged.

#### Scenario: Template error surfaces as a structured error

- **WHEN** a template REST call receives a non-2xx RFC 9457 response
- **THEN** it SHALL throw a `TemplateApiError` (a subclass or alias of `ApiError`) carrying `status`, `type`, and a `detail`-first `message`, with its existing public field names preserved

#### Scenario: Existing template-editor catch sites keep working

- **WHEN** a template-editor consumer catches a template error and reads the fields it relied on previously (including `.message`)
- **THEN** those reads SHALL behave identically to before the unification

#### Scenario: parseError removed from the template client

- **WHEN** `reader-src/src/lib/template-api.ts` is searched for `parseError`
- **THEN** no matches SHALL be returned
