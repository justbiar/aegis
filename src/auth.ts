import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  // Falls back to a fixed dev-only secret so `npm run dev` works before
  // AUTH_SECRET is set. Always set a real AUTH_SECRET before deploying.
  secret: process.env.AUTH_SECRET ?? "dev-only-insecure-secret-do-not-deploy",
});
