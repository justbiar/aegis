import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  // Falls back to a fixed dev-only secret so `npm run dev` works before
  // AUTH_SECRET is set. Always set a real AUTH_SECRET before deploying.
  secret: process.env.AUTH_SECRET ?? "dev-only-insecure-secret-do-not-deploy",
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
