import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const metadata = { title: "Policy Radar — sign in" };

async function signIn(formData: FormData) {
  "use server";
  const given = String(formData.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";
  if (given && given === expected) {
    (await cookies()).set("pr_gate", expected, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    redirect("/");
  }
  redirect("/login?bad=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ bad?: string }> }) {
  const { bad } = await searchParams;
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16 }}>
      <form action={signIn} className="panel" style={{ padding: 22, width: "min(360px,100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <span className="dot" style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent-line)" }} />
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Policy Radar</h1>
        </div>
        <p className="note" style={{ marginTop: 0 }}>Regulatory and legislative watch</p>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="password">Pilot password</label>
          <input id="password" name="password" type="password" autoFocus autoComplete="current-password" />
          {bad ? <span className="warn">That password is wrong.</span> : null}
        </div>
        <button className="btn pri" style={{ marginTop: 14, width: "100%" }}>Sign in</button>
      </form>
    </main>
  );
}
