import { redirect } from "next/navigation";

interface AccountIndexProps {
  params: { locale: string };
}

export default function AccountIndex({ params }: AccountIndexProps): never {
  redirect(`/${params.locale}/account/profile`);
}
