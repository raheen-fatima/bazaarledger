import { useEffect, useState } from 'react';
import { Layout, Menu, Button, Drawer } from 'antd';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  AppstoreOutlined,
  InboxOutlined,
  TagsOutlined,
  TeamOutlined,
  HistoryOutlined,
  BarChartOutlined,
  SettingOutlined,
  CloudDownloadOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api.ts';

const { Sider, Header, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { key: '/', label: 'Dashboard', icon: <DashboardOutlined /> },
  { key: '/pos', label: 'Point of Sale', icon: <ShoppingCartOutlined /> },
  { key: '/products', label: 'Products', icon: <AppstoreOutlined /> },
  { key: '/inventory', label: 'Inventory', icon: <InboxOutlined /> },
  { key: '/categories', label: 'Categories', icon: <TagsOutlined /> },
  { key: '/customers', label: 'Customers', icon: <TeamOutlined /> },
  { key: '/sales', label: 'Sales History', icon: <HistoryOutlined /> },
  { key: '/reports', label: 'Reports', icon: <BarChartOutlined /> },
  { key: '/settings', label: 'Settings', icon: <SettingOutlined /> },
  { key: '/backup', label: 'Backup & Restore', icon: <CloudDownloadOutlined /> },
];

export function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  // F2 keyboard shortcut to jump directly to Point of Sale register
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        navigate('/pos');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const activeItem =
    NAV_ITEMS.find((item) => item.key === location.pathname) ?? NAV_ITEMS[0];

  const menuElement = (
    <Menu
      mode="inline"
      selectedKeys={[activeItem.key]}
      onClick={({ key }) => {
        navigate(key);
        setMobileMenuOpen(false);
      }}
      items={NAV_ITEMS.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
      }))}
      className="border-r-0! px-2 py-2"
    />
  );

  return (
    <Layout className="min-h-screen bg-[#f5f7fa]">
      <Sider
        width={240}
        theme="light"
        className="hidden md:block border-r border-slate-200 bg-white no-print"
        style={{ position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
      >
        <div className="flex h-14 items-center border-b border-slate-200 px-5">
          <div className="truncate font-semibold text-base tracking-tight text-slate-900">
            BazaarLedger POS
          </div>
        </div>
        {menuElement}
      </Sider>

      <Drawer
        title="BazaarLedger POS"
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        width={240}
        styles={{ body: { padding: 0 } }}
      >
        {menuElement}
      </Drawer>

      <Layout className="bg-[#f5f7fa]">
        <Header
          className="no-print flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6"
          style={{ paddingInline: 24, lineHeight: 'normal', height: 56, background: '#ffffff' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden!"
              aria-label="Open menu"
            />
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="m-0 text-base font-semibold text-slate-900 truncate">
                {activeItem.label}
              </h1>
              {settings?.shop_name && (
                <>
                  <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                    /
                  </span>
                  <span className="hidden sm:inline text-sm text-slate-500 truncate">
                    {settings.shop_name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {location.pathname !== '/pos' && (
              <Button
                type="primary"
                icon={<ShoppingCartOutlined />}
                onClick={() => navigate('/pos')}
              >
                Open POS (F2)
              </Button>
            )}
          </div>
        </Header>

        <Content className="p-4 md:p-6">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
