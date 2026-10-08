declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CF_ACCESS_TEAM_URL?: string;
    CF_ACCESS_AUD?: string;
    R2_STORAGE_QUOTA_BYTES?: string;
    R2_CLASS_A_MONTHLY_LIMIT?: string;
    R2_CLASS_B_MONTHLY_LIMIT?: string;
    CF_ACCESS_GROUP_ID?: string;
    // Secrets, set with `wrangler secret put`.
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
  }
}
