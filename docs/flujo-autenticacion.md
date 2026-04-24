# Flujo de autenticación GitHub y credenciales por proyecto

Este documento describe el flujo completo del CLI `workspace-template`
para autenticar con GitHub y configurar credenciales **por proyecto**
(sin tocar la configuración global de la máquina).

Los diagramas usan [Mermaid](https://mermaid.js.org/). Se renderizan
nativamente en GitHub, VSCode (con extensión Mermaid Preview) y en
cualquier editor compatible.

---

## 1. Flujo maestro — todos los pasos del setup

```mermaid
flowchart TD
    Start([npx workspace-template]) --> P1[Paso 1<br/>Verificar entorno]
    P1 --> P2[Paso 2<br/>Autenticación GitHub]
    P2 --> P3[Paso 3<br/>Tipo de proyecto:<br/>single o multi]
    P3 --> P4ctx[Paso 4a<br/>Contexto: descripción + dominio]
    P4ctx --> P4skills[Paso 4b<br/>Selección de skills]
    P4skills --> P4mcp[Paso 4c<br/>Integraciones MCP]
    P4mcp --> TypeCheck{¿single<br/>o multi?}
    TypeCheck -->|single| P4single[Paso 4d<br/>stepSingleRepo]
    TypeCheck -->|multi| P4multi[Paso 4d<br/>stepMultiRepo]
    P4single --> Persist[Persistencia:<br/>git config user.name local<br/>+ .env.local si hay token]
    P4multi --> Persist
    Persist --> P5[Paso 5<br/>GitHub Project]
    P5 --> P6[Paso 6<br/>Resumen]
    P6 --> End([Fin])
```

---

## 2. Paso 2 — Autenticación GitHub (detalle)

Este es el corazón de la lógica nueva: decide si usar cuenta global
de `gh`, si pedir un token por proyecto, o si instalar `gh` por primera vez.

```mermaid
flowchart TD
    Start([Paso 2 inicia]) --> GhCheck{¿gh CLI instalado?}

    GhCheck -->|Sí| AuthCheck{¿Sesión activa<br/>en gh?}
    GhCheck -->|No| NoGh[Mostrar opciones<br/>sin gh instalado]

    AuthCheck -->|Sí| AskGlobal{¿Usar cuenta<br/>global detectada?}
    AuthCheck -->|No| WarnNoSession[Aviso: gh sin sesión]

    AskGlobal -->|Sí| UseGlobal[ghUser = cuenta global<br/>projectToken = null]
    AskGlobal -->|No| ChooseMode

    WarnNoSession --> ChooseMode{Elegir modo<br/>de autenticación}

    ChooseMode -->|token por proyecto| AskToken1[askAndValidateToken]
    ChooseMode -->|gh auth login| GhLogin[Ejecutar gh auth login<br/>modo interactivo]

    GhLogin --> RecheckAuth{¿Autenticado<br/>ahora?}
    RecheckAuth -->|Sí| UseGlobal
    RecheckAuth -->|No| Abort([Abortar])

    NoGh --> InstallChoice{¿Instalar gh<br/>o solo token?}
    InstallChoice -->|Instalar gh global| InstallGh[Mostrar instrucciones<br/>apt/brew/winget]
    InstallChoice -->|Solo token proyecto| AskToken2[askAndValidateToken<br/>valida con curl]

    InstallGh --> PostInstall{¿gh disponible<br/>tras instalar?}
    PostInstall -->|Sí + sesión| UseGlobal
    PostInstall -->|No| AskToken2

    AskToken1 --> ValidToken{¿Token válido?}
    AskToken2 --> ValidToken
    ValidToken -->|Sí| UseToken[ghUser = usuario del token<br/>projectToken = token]
    ValidToken -->|No| Retry[Reintentar token]
    Retry --> AskToken1

    UseGlobal --> Done([Retorna ghUser, projectToken])
    UseToken --> Done
```

**Validación de token** (`askAndValidateToken`):

```mermaid
flowchart LR
    A[Pedir token] --> B{¿gh instalado?}
    B -->|Sí| C[gh api user<br/>con GH_TOKEN env]
    B -->|No| D[curl api.github.com/user<br/>con Authorization header]
    C --> E{¿HTTP 200?}
    D --> E
    E -->|Sí| F[Token válido<br/>+ extraer username]
    E -->|No| G[Reintentar]
    G --> A
```

---

## 3. Paso 4 — single-repo

Tres caminos: `github`, `local`, `scratch`.

```mermaid
flowchart TD
    Start([stepSingleRepo]) --> Origin{¿Origen<br/>del repo?}

    Origin -->|github| G1[Pedir URL]
    Origin -->|local| L1[Pedir ruta local]
    Origin -->|scratch| S1[Pedir directorio destino]

    %% Camino github
    G1 --> G2[extractCredsFromUrl]
    G2 --> G3{¿URL tiene<br/>user:token@?}
    G3 -->|Sí| G4[ghUser y projectToken<br/>extraídos de URL]
    G3 -->|No| G5[Usar ghUser/token<br/>del Paso 2]
    G4 --> G6[clone con creds<br/>embebidas en URL]
    G5 --> G6
    G6 --> G7{¿Hay projectToken?}
    G7 -->|Sí| G8[setRepoRemoteWithCreds<br/>+ setGitUserLocal]
    G7 -->|No| Common

    %% Camino local
    L1 --> L2[getRemoteOrigin]
    L2 --> L3{¿Remote existe?}
    L3 -->|Sí| L4{owner del remote<br/>≠ ghUser<br/>Y sin projectToken?}
    L3 -->|No| Common
    L4 -->|Sí, conflicto| L5[Avisar:<br/>cuentas distintas]
    L4 -->|No| L7
    L5 --> L6{¿Ingresar token<br/>para resolver?}
    L6 -->|Sí| L6a[askAndValidateToken<br/>actualiza ghUser y projectToken]
    L6 -->|No| L7[Continuar sin token<br/>push podría fallar]
    L6a --> L7
    L7 --> L8{¿Hay projectToken?}
    L8 -->|Sí| L9[setRepoRemoteWithCreds<br/>+ setGitUserLocal]
    L8 -->|No| Common

    %% Camino scratch
    S1 --> S2[Pedir owner + stacks]
    S2 --> S3{¿Template<br/>por stack?}
    S3 -->|Sí| S4[git clone del template]
    S3 -->|No| S5[git init]
    S4 --> S6[gh repo create<br/>con GH_TOKEN si hay]
    S5 --> S6
    S6 --> S7{¿Hay projectToken?}
    S7 -->|Sí| S8[setRepoRemoteWithCreds<br/>+ setGitUserLocal]
    S7 -->|No| Common

    G8 --> Common
    L9 --> Common
    S8 --> Common

    Common[Generar CLAUDE.md<br/>+ .claude/<br/>+ issue templates<br/>+ commit inicial]
    Common --> End([Retorna repoPath, owner, repoName])
```

---

## 4. Paso 4 — multi-repo (batch)

El batch procesa múltiples URLs/rutas. Si detecta conflicto o creds
embebidas en medio del batch, el token se propaga a los repos restantes.

```mermaid
flowchart TD
    Start([stepMultiRepo]) --> Ask[Pedir lista de repos<br/>URLs o paths]
    Ask --> Loop{Para cada<br/>entrada del batch}

    Loop -->|path| P1[Leer remote origin]
    Loop -->|url| U1[extractCredsFromUrl]

    %% path
    P1 --> P2{¿remote owner<br/>≠ ghUser<br/>Y sin projectToken?}
    P2 -->|Sí, conflicto| P3[Avisar conflicto]
    P2 -->|No| Apply
    P3 --> P4{¿Ingresar token<br/>para este y los<br/>siguientes?}
    P4 -->|Sí| P5[askAndValidateToken<br/>actualiza projectToken<br/>+ ghUser]
    P4 -->|No| Apply
    P5 --> Apply

    %% url
    U1 --> U2{¿URL tiene<br/>user:token@?}
    U2 -->|Sí| U3[Actualizar<br/>projectToken + ghUser]
    U2 -->|No| U4[Usar los del Paso 2]
    U3 --> U5[cloneRepo con creds]
    U4 --> U5
    U5 --> Apply

    Apply{¿Hay projectToken?}
    Apply -->|Sí| AS[setRepoRemoteWithCreds<br/>+ setGitUserLocal<br/>en este repo]
    Apply -->|No| Ask2

    AS --> Ask2[Pedir rol, puerto,<br/>stacks del repo]
    Ask2 --> Next{¿Más repos<br/>en el batch?}
    Next -->|Sí| Loop
    Next -->|No| Gen[Generar CLAUDE.md<br/>workspace + cada repo]

    Gen --> End([Retorna workspacePath, repos])
```

**Clave**: el `projectToken` es variable del scope de `stepMultiRepo`.
Si se actualiza en medio del loop (por conflicto o URL con creds),
los repos siguientes del batch ya lo reciben.

---

## 5. Persistencia final

Después de `stepSingleRepo` / `stepMultiRepo`, el flujo principal
persiste configuración en **cada** repo:

```mermaid
flowchart TD
    Start([Fin de Paso 4]) --> Collect[allRepoPaths:<br/>single: un repo<br/>multi: workspace + cada repo]
    Collect --> Loop1{Para cada path}
    Loop1 --> GitUser[git config user.name<br/>LOCAL en repo<br/>no global]
    Loop1 --> Next1{¿Más paths?}
    Next1 -->|Sí| Loop1
    Next1 -->|No| TokenCheck{¿Hay<br/>projectToken?}

    TokenCheck -->|Sí| Loop2{Para cada path}
    TokenCheck -->|No| P5([Paso 5])

    Loop2 --> Env[Escribir .env.local<br/>GITHUB_USER, GH_TOKEN]
    Env --> GI[Agregar .env.local<br/>a .gitignore]
    GI --> Next2{¿Más paths?}
    Next2 -->|Sí| Loop2
    Next2 -->|No| P5
```

**Qué se crea en cada repo:**

| Archivo / Config                              | Cuándo                    | Scope        |
|-----------------------------------------------|---------------------------|--------------|
| `.git/config` → `remote origin` con creds     | Si hay `projectToken`     | Repo local   |
| `.git/config` → `user.name`                   | Siempre                   | Repo local   |
| `.env.local` con `GITHUB_USER` y `GH_TOKEN`   | Si hay `projectToken`     | Archivo repo |
| `.gitignore` → agregar `.env.local`           | Si hay `projectToken`     | Archivo repo |

Nada toca `~/.gitconfig` ni `gh auth login` global.

---

## 6. Matriz de casos cubiertos

| Caso                                                          | Resultado                                                |
|---------------------------------------------------------------|----------------------------------------------------------|
| gh instalado + sesión global + usuario acepta global          | Usa sesión global, sin `.env.local`                      |
| gh instalado + sesión global + usuario quiere otra cuenta     | Pide token por proyecto, guarda `.env.local`             |
| gh instalado sin sesión                                       | Ofrece token proyecto o `gh auth login`                  |
| gh no instalado                                               | Token con validación por curl (sin instalar nada)        |
| URL pegada con `user:token@github.com/...`                    | Extrae creds, **valida antes de clonar**, guarda por proyecto |
| URL con token caducado embebido                               | Preflight lo detecta, ofrece reingresar o continuar sin token |
| Repo local con remote de cuenta distinta + sin token          | Detecta conflicto, ofrece ingresar token                 |
| Repo local sin `.git/`                                        | Single: ofrece `git init`. Multi: se salta               |
| Multi-repo con primer repo en conflicto                       | Token ingresado se aplica al resto del batch             |
| Token ingresado manualmente inválido                          | Reintenta hasta que sea válido                           |
| Usuario cancela con Ctrl+C durante clone                      | Handler SIGINT elimina directorios parciales creados     |
| Usuario cancela prompt con Ctrl+C                             | `ExitPromptError` también dispara limpieza               |
| `.env.local` pre-existente con otras variables                | Preservadas; solo se agregan/actualizan `GITHUB_USER` + `GH_TOKEN` |
| Token en logs                                                 | Siempre enmascarado como `:***@` con `maskUrlCreds()`    |
| Comandos `gh project` (create/view/list)                      | Reciben `GH_TOKEN` del proyecto si aplica                |

---

## 7. Archivos del código relevantes

- [bin/workspace-template.js](../bin/workspace-template.js) — CLI principal
  - `stepGithubAuth` — Paso 2
  - `askAndValidateToken` — validación de token
  - `stepSingleRepo` — 3 caminos (github/local/scratch)
  - `stepMultiRepo` — batch con propagación de token
  - `main` — persistencia final por repo

- [lib/github.js](../lib/github.js) — utilidades git/GitHub
  - `isGhInstalled` — detecta gh CLI
  - `isGitRepo` — detecta si un path tiene `.git/`
  - `checkGhAuth` — estado de sesión global
  - `validateGithubToken` / `validateTokenWithCurl` — valida tokens
  - `extractCredsFromUrl` — parsea `user:token@github.com/...`
  - `maskUrlCreds` — enmascara token para logs (`:***@`)
  - `saveProjectGithubCredentials` — escribe `.env.local` + `.gitignore` (preserva variables existentes)
  - `setRepoRemoteWithCreds` — reescribe `.git/config` remote
  - `setGitUserLocal` — `git config --local user.name`
  - `cloneRepo` — clone con creds embebidas; sanitiza URLs en spinners/errores
  - `createGithubProject` / `getGithubProject` / `listGithubProjects` — aceptan `token` opcional para usar `GH_TOKEN` del proyecto

## 8. Manejo de interrupciones

El CLI tiene un tracker global de directorios creados (`createdResources.dirs`)
para poder limpiar estado parcial si el usuario cancela:

```mermaid
flowchart TD
    Start([Usuario ejecuta CLI]) --> Track[trackCreatedDir en cada:<br/>- cloneRepo destino<br/>- workspace recién creado<br/>- mkdirSync para scratch]
    Track --> Running{¿Flujo completado?}
    Running -->|Sí| Clear[dirs.clear<br/>no se borra nada]
    Running -->|Ctrl+C| Sigint[SIGINT handler]
    Running -->|Error| Catch[catch top-level]
    Sigint --> Cleanup[cleanupPartialState<br/>rm -rf cada dir tracked]
    Catch --> Cleanup
    Cleanup --> Exit([exit])
    Clear --> Done([Éxito])
```

**Importante**: solo se eliminan directorios **creados por este setup**,
nunca directorios que ya existían antes.
