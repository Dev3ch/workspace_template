# Reglas de stack — Flutter

## Estructura del proyecto

```
lib/
  main.dart
  app/           ← configuración global (rutas, tema, providers)
  features/      ← una carpeta por feature (ui, data, domain)
  shared/        ← widgets y utilidades reutilizables
test/
  unit/
  widget/
  integration/
```

## Convenciones de código

- Nombres en `camelCase` para variables y métodos, `PascalCase` para clases y widgets.
- Un widget por archivo. Nombre del archivo en `snake_case` igual al nombre de la clase.
- Preferir `const` constructors siempre que sea posible.
- Evitar lógica de negocio dentro de widgets — delegar a providers / blocs / controllers.

## State management

Usar el gestor de estado definido en el proyecto (Riverpod / BLoC / Provider).
No mezclar soluciones de estado en el mismo proyecto.

## Testing

- Unit tests para lógica de negocio (sin Flutter SDK).
- Widget tests para componentes UI aislados.
- Integration tests para flujos completos en `integration_test/`.

```bash
flutter test
flutter test integration_test/
```

## Assets y temas

- Assets declarados en `pubspec.yaml`.
- Colores y estilos centralizados en `AppTheme` — no hardcodear colores en widgets.

## Build

```bash
# Android
flutter build apk --release

# iOS
flutter build ipa --release

# Web
flutter build web --release
```
