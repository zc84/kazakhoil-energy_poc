# Environment and Secrets Policy

## Local development

- `infra/compose.yaml` is the default local runtime.
- Development secrets are stored in uncommitted `.env` files.
- Raw import files must stay outside Git history.

## Baseline variables

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT_URL`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET_RAW_IMPORTS`
- `APP_ENV`
- `ENERGOPULSE_OPENAI_API_KEY` (optional backend fallback)

## Rules

- Do not hardcode credentials in frontend code, fixtures, or Dockerfiles.
- Use separate credentials for `web`, `api`, `worker`, and object storage where applicable.
- Keep production secrets in the deployment platform secret manager only.
- The AI settings UI stores an OpenAI key server-side in `ai_settings` and only
  returns a masked value. Protect settings endpoints with administrator
  authentication before production use.
- Rotate any leaked local development secret before the next shared environment deploy.
