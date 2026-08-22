import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  // Dev-only fallback so `npm run dev` works before AUTH_SECRET is set. In
  // production the fallback is withheld on purpose: a predictable secret lets
  // anyone forge a session (impersonate any GitHub login and redirect that
  // owner's rescue to their own address), so next-auth should hard-fail at
  // startup rather than run with a guessable secret.
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret-do-not-deploy"),
  callbacks: {
    // The default session only carries name/email/image. Claims are matched
    // against a repo's owner segment, which needs the actual GitHub login
    // (username), not the display name.
    async jwt({ token, profile }) {
      if (profile && typeof (profile as any).login === "string") {
        token.login = (profile as any).login;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.login === "string") {
        (session.user as any).login = token.login;
      }
      return session;
    },
  },
});
