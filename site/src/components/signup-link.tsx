import type { ComponentProps } from "react";
import { SIGNUP_URL } from "@/lib/marketing-attribution";

export function SignupLink(props: Omit<ComponentProps<"a">, "href">) {
  return <a {...props} href={SIGNUP_URL} />;
}
