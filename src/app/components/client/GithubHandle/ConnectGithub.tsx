"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import styles from "../../../uni.module.css";

export default function ConnectGithub() {
  const { data: session, status } = useSession();

  if (status === "authenticated" && session.user) {
    return (
      <button
        className={styles.addrPill}
        onClick={() => signOut()}
        title="Disconnect GitHub"
      >
        <span className={styles.addrDot} />
        {session.user.name ?? session.user.email}
        <span className={styles.addrDisconnect}>Disconnect</span>
      </button>
    );
  }

  return (
    <button
      className={styles.connectPill}
      onClick={() => signIn("github")}
      disabled={status === "loading"}
    >
      Connect GitHub
    </button>
  );
}
