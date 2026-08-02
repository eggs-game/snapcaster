export function accountDisplayName(account) {
  if (account?.profile?.display_name) return account.profile.display_name;
  const metadata = account?.user?.user_metadata || {};
  return metadata.global_name || metadata.full_name || metadata.name || metadata.user_name || "Snapcast player";
}

export function accountAvatarUrl(account) {
  if (account?.profile?.avatar_url) return account.profile.avatar_url;
  const metadata = account?.user?.user_metadata || {};
  return metadata.avatar_url || metadata.picture || "";
}

export function accountDiscordName(account) {
  const metadata = account?.user?.user_metadata || {};
  return account?.privateAccount?.discord_username
    || metadata.global_name
    || metadata.custom_claims?.global_name
    || metadata.preferred_username
    || metadata.user_name
    || metadata.full_name
    || metadata.name
    || accountDisplayName(account);
}
