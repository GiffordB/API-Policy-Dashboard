import { redirect } from "next/navigation";

/** The dashboard lives at one page per track. Regulatory is the front door. */
export default function Home() {
  redirect("/regulatory");
}
