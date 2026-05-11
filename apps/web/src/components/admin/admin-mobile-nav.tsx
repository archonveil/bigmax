"use client";

/**
 * `<AdminMobileNav>` (P6-T1 follow-up) — гамбургер-кнопка + Sheet-drawer
 * с `<AdminNav>` внутри. Виден только на `< lg` (sm/md), на десктопе layout
 * рендерит aside напрямую.
 *
 * Drawer закрывается на любом тапе по nav-link через `usePathname()`
 * effect — без него юзер бы тапнул «Заказы», страница загрузилась, а
 * sheet остался поверх контента.
 */

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AdminMobileNav(): JSX.Element {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Закрываем drawer на смене pathname — link внутри изменил route, sheet
  // должен исчезнуть. `pathname` стабилен в navigation-events Next 14.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="lg:hidden"
          data-testid="admin-mobile-menu-button"
        >
          <Menu className="mr-2 h-4 w-4" aria-hidden />
          {t("menuButton")}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72" data-testid="admin-mobile-menu">
        <SheetHeader className="mb-4 text-left">
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <AdminNav />
      </SheetContent>
    </Sheet>
  );
}
