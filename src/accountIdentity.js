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
