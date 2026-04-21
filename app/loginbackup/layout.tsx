import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // If user is already logged in, they shouldn't be able to view the login page
  // Redirect them directly to the dashboard
  if (session?.user) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
