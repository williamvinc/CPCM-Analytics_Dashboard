"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Image from "next/image";
import logoImg from "@/assets/logo.webp";
import styles from "./alt-login.module.css";

export default function AltLoginPage() {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [isLogin, setIsLogin] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      if (!isLogin) {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to register");

        setSuccessMsg("Successfully registered!");
        setIsLogin(true);
        setPassword("");
        setName("");
      } else {
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) throw new Error("Wrong credentials");
        router.push("/dashboard");
      }
    } catch (error: any) {
      setErrorMsg(error.message || "Wrong credentials");
    } finally {
      setLoading(false);
    }
  };

  // Build shape class modifiers based on focused field
  const shapeModifier = focusedField === "name"
    ? styles.focusName
    : focusedField === "email"
      ? styles.focusEmail
      : focusedField === "password"
        ? styles.focusPassword
        : "";

  return (
    <div className={`${styles.page} ${shapeModifier}`}>
      {/* ── LEFT PANEL: Form ── */}
      <div className={styles.leftPanel}>
        {/* Blurred cyan circle (frosted mirror of the right panel's circle) */}
        <div className={`${styles.shape} ${styles.shapeCyanBlurred}`} />
        {/* Pink blob bottom-left */}
        <div className={`${styles.shape} ${styles.shapePinkBlob}`} />
        <div className={styles.formWrapper}>
          {/* Logo */}
          <div className={styles.logo}>
            <Image
              src={logoImg}
              alt="CPCM Logo"
              width={60}
              height={60}
              priority
              className={styles.logoImg}
            />
          </div>

          {/* Title */}
          <h1 className={styles.title}>
            {isLogin ? "Sign in" : "Sign up"}
          </h1>

          {/* Google button */}
          <button type="button" className={styles.googleBtn}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>

          {/* Divider */}
          <p className={styles.dividerText}>
            {isLogin ? "Or sign in with email" : "Or sign up with email"}
          </p>

          {/* Error / Success messages */}
          {errorMsg && (
            <div className={styles.errorMsg}>{errorMsg}</div>
          )}
          {successMsg && (
            <div className={styles.successMsg}>{successMsg}</div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className={styles.form}>
            {!isLogin && (
              <input
                type="text"
                placeholder="Full name"
                value={name}
                required={!isLogin}
                onChange={(e) => { setName(e.target.value); setErrorMsg(""); }}
                onFocus={() => setFocusedField("name")}
                onBlur={() => setFocusedField(null)}
                className={styles.input}
              />
            )}

            <input
              type="email"
              placeholder="Email"
              value={email}
              required
              onChange={(e) => { setEmail(e.target.value); setErrorMsg(""); }}
              onFocus={() => setFocusedField("email")}
              onBlur={() => setFocusedField(null)}
              className={styles.input}
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              required
              onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
              onFocus={() => setFocusedField("password")}
              onBlur={() => setFocusedField(null)}
              className={styles.input}
            />

            <button
              type="submit"
              disabled={loading}
              className={styles.submitBtn}
            >
              {loading ? "Please wait..." : isLogin ? "Sign In" : "Sign Up"}
            </button>
          </form>

          {/* Toggle login/register */}
          <p className={styles.toggleText}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrorMsg("");
                setSuccessMsg("");
              }}
              className={styles.toggleBtn}
            >
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL: Decorative ── */}
      <div className={styles.rightPanel}>
        {/* Main shapes */}
        <div className={`${styles.shape} ${styles.shapeCoralCircle}`} />
        <div className={`${styles.shape} ${styles.shapeCyanCircleRight}`} />
        <div className={`${styles.shape} ${styles.shapeTealTriangle}`} />
        <div className={`${styles.shape} ${styles.shapePinkPill}`} />
        <div className={`${styles.shape} ${styles.shapePinkDot}`} />

        {/* Memphis accents */}
        <div className={`${styles.shape} ${styles.memphisRing1}`} />
        <div className={`${styles.shape} ${styles.memphisCross1}`} />
        <div className={`${styles.shape} ${styles.memphisSquare}`} />

        <div className={styles.heroText}>
          <span className={styles.heroLine1}>CPCM</span>
          <span className={styles.heroLine2}>Analytics Dashboard</span>
        </div>
      </div>
    </div>
  );
}
