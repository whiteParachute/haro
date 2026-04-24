import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { RootLayout } from '@/components/layout/RootLayout';
import { navigationItems } from '@/components/layout/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { HomePage } from '@/pages/HomePage';

function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          此页面将在后续 FEAT 中逐步补齐，目前仅保留导航占位与布局结构。
        </CardContent>
      </Card>
    </div>
  );
}

const placeholderRoutes = navigationItems.filter((item) => item.to !== '/');

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<HomePage />} />
          {placeholderRoutes.map((item) => (
            <Route
              key={item.to}
              path={item.to.slice(1)}
              element={<PlaceholderPage title={item.title} description={item.description} />}
            />
          ))}
          <Route
            path="*"
            element={
              <PlaceholderPage
                title="页面未找到"
                description="当前访问的路由尚未定义。"
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
