"use client"

import * as React from "react"
import { useSession } from "next-auth/react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { QuickExport } from "@/components/quick-export"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, WalletIcon, CommandIcon, SettingsIcon, Calculator, Plane } from "lucide-react"

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: <LayoutDashboardIcon />,
    },
    {
      title: "Finance",
      url: "#",
      icon: <WalletIcon />,
      items: [
        {
          title: "Reports",
          items: [
            {
              title: "F&B Report",
              url: "/dashboard/fnb-report",
            },
            {
              title: "JMH Retail Report",
              url: "/dashboard/jmh-retail-report",
            },
          ]
        },
        {
          title: "Banks",
          items: [
            {
              title: "Discount Report",
              url: "/dashboard/discount-report",
            },
            {
              title: "Merchant Bank Report",
              url: "/dashboard/merchant-bank",
            },
          ]
        },
        {
          title: "To be Confirm",
          items: [
            {
              title: "Overview",
              url: "/dashboard/finance",
            },
            {
              title: "Master Data",
              url: "/dashboard/finance/master-data",
            },
            {
              title: "Inventory",
              url: "/dashboard/finance/inventory",
            },
            {
              title: "UOM Management",
              url: "/dashboard/finance/uom-management",
            },
            {
              title: "Users",
              url: "/dashboard/finance/users",
            },
          ]
        },
      ]
    },
    {
      title: "Ops",
      url: "#",
      icon: <SettingsIcon />,
      items: [
        {
          title: "Machine Rate Tracker",
          url: "/dashboard/machine_rate_tracker",
        },
      ]
    },
    {
      title: "COGS",
      url: "#",
      icon: <Calculator />,
      items: [
        {
          title: "Master Data",
          url: "/dashboard/cogs",
        },
      ]
    },
    {
      title: "OTA Report",
      url: "/dashboard/ota-report",
      icon: <Plane />,
    },
    // {
    //   title: "Lifecycle",
    //   url: "#",
    //   icon: <ListIcon />,
    // },
    // {
    //   title: "Analytics",
    //   url: "#",
    //   icon: <ChartBarIcon />,
    // },
    // {
    //   title: "Projects",
    //   url: "#",
    //   icon: <FolderIcon />,
    // },
    // {
    //   title: "Team",
    //   url: "#",
    //   icon: <UsersIcon />,
    // },
  ],
  // navClouds: [
  //   {
  //     title: "Capture",
  //     icon: <CameraIcon />,
  //     isActive: true,
  //     url: "#",
  //     items: [
  //       { title: "Active Proposals", url: "#" },
  //       { title: "Archived", url: "#" },
  //     ],
  //   },
  //   {
  //     title: "Proposal",
  //     icon: <FileTextIcon />,
  //     url: "#",
  //     items: [
  //       { title: "Active Proposals", url: "#" },
  //       { title: "Archived", url: "#" },
  //     ],
  //   },
  //   {
  //     title: "Prompts",
  //     icon: <FileTextIcon />,
  //     url: "#",
  //     items: [
  //       { title: "Active Proposals", url: "#" },
  //       { title: "Archived", url: "#" },
  //     ],
  //   },
  // ],
  // navSecondary: [
  //   {
  //     title: "Settings",
  //     url: "#",
  //     icon: <Settings2Icon />,
  //   },
  //   {
  //     title: "Get Help",
  //     url: "#",
  //     icon: <CircleHelpIcon />,
  //   },
  //   {
  //     title: "Search",
  //     url: "#",
  //     icon: <SearchIcon />,
  //   },
  // ],
  // documents: [
  //   {
  //     name: "Data Library",
  //     url: "#",
  //     icon: <DatabaseIcon />,
  //   },
  //   {
  //     name: "Reports",
  //     url: "#",
  //     icon: <FileChartColumnIcon />,
  //   },
  //   {
  //     name: "Word Assistant",
  //     url: "#",
  //     icon: <FileIcon />,
  //   },
  // ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession()

  const user = {
    name: session?.user?.name || "Guest",
    email: session?.user?.email || "guest@example.com",
    avatar: "",
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="/dashboard">
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">MooBoard</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="pt-2">
            <QuickExport />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {/* <NavDocuments items={data.documents} /> */}
        {/* <NavSecondary items={data.navSecondary} className="mt-auto" /> */}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
