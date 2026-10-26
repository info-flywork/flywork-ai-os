import {
  Bell,
  CalendarDays,
  Coins,
  Cpu,
  Kanban,
  LayoutDashboard,
  MessageSquarePlus,
  Receipt,
  Users,
  Utensils,
  Workflow,

} from "lucide-react";


 







export const panelNav = [
  { name: "Ana Sayfa", path: "/", icon: LayoutDashboard, roles: ["ADMIN"], keywords: "dashboard özet" },
  { name: "Bildirimler", path: "/bildirimler", icon: Bell, roles: ["ADMIN"], keywords: "uyarı okunmamış" },
  { name: "İş Takibi", path: "/is-takibi", icon: Kanban, roles: ["ADMIN", "EMPLOYEE"], keywords: "trello kart iş atama öncelik süre" },
  { name: "Yemek", path: "/yemek-yonetimi", icon: Utensils, roles: ["ADMIN", "EMPLOYEE"], keywords: "menü sipariş yemek organizasyonu" },
  { name: "İzin", path: "/izin", icon: CalendarDays, roles: ["ADMIN", "EMPLOYEE"], keywords: "talep bakiye" },
  { name: "Harcamalar ve Faturalar", path: "/harcama", icon: Receipt, roles: ["ADMIN"], keywords: "harcama fatura ofis flywork gider" },
  { name: "Primler", path: "/prim", icon: Coins, roles: ["ADMIN"], keywords: "prim ödeme kriter uygulama" },
  { name: "Abonelikler", path: "/teknoloji", icon: Cpu, roles: ["ADMIN"], keywords: "abonelik alan adı sunucu ödeme" },
  { name: "Otomasyon", path: "/otomasyon", icon: Workflow, roles: ["ADMIN"], keywords: "worker telegram tarama" },
  { name: "Kullanıcılar", path: "/kullanicilar", icon: Users, roles: ["ADMIN"], keywords: "profil hesap rol" },
  { name: "Öneri ve Geri Bildirim", path: "/oneri", icon: MessageSquarePlus, roles: ["ADMIN", "EMPLOYEE"], keywords: "öneri şikayet geri bildirim" },
];
