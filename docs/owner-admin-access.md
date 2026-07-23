# Owner and platform-admin access

Lodesta treats website ownership and platform administration as separate authorities:

- A user sees a website in owner mode only when `sites.owner_user_id` exactly matches the authenticated user ID.
- A human administrator is authorized by the trusted Supabase Auth metadata value `app_metadata.lodesta_roles`, which must contain `platform_admin`.
- `user_metadata` never grants platform access because an authenticated user can edit it.
- `LODESTA_ADMIN_TOKEN` remains the machine/operator credential for APIs and CLI workflows.

All authenticated users enter through `/account`. A platform administrator receives the normal owner experience for websites assigned to their user ID and can open the separate admin console from the account menu. Opening an unowned website from its admin record uses the visibly labeled admin-preview context and limits the owner-style site switcher to that website.

## Grant or revoke a human administrator

Use a Supabase Auth user ID obtained through the protected operator environment. The command uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, preserves unrelated app metadata, and never writes the ID to the repository.

```sh
npm run access:platform-admin -- grant <auth-user-id>
npm run access:platform-admin -- revoke <auth-user-id>
```

Before deploying the clean break from `LODESTA_ADMIN_USER_ID`, grant the existing founder user, verify `/admin/sites` access, deploy the new authorization code, and then remove the obsolete environment variable from the deployment configuration.

## QA personas

Use two distinct synthetic, non-customer sites and two separate browser profiles:

1. The founder profile has `platform_admin` and directly owns the founder demo site.
2. The owner-QA profile has no platform role and directly owns a separate QA site.

Verify that both profiles land in `/account`; each owner inventory contains only its owned site; only the founder sees Admin console; the owner-QA profile receives no admin access; and an unowned site opened by the founder is labeled Admin preview. Keep account emails, Auth user IDs, magic links, and credentials out of source control and screenshots.
