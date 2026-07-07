import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/beranda.tsx"),
  route("home", "routes/home.tsx"),
  route("pantau-harga", "routes/pantau-harga.tsx"),
  route("analisis-harga", "routes/analisis-harga.tsx"),
  route("analisis-harga/versus-pasar", "routes/analisis-harga-versus-pasar.tsx"),
  route("analisis-harga/detail-pasar", "routes/analisis-harga-detail-pasar.tsx"),
  route("prediksi", "routes/prediksi.tsx"),
] satisfies RouteConfig;
