## Purpose
提供「白天 / 暗黑 / 跟随系统」三态主题模式；默认跟随系统，用户选择持久化于 renderer localStorage，切换即时生效，业务与契约层不变。

## ADDED Requirements

### Requirement: 三态主题模式与默认跟随系统
The system SHALL 提供 `system`（默认）/ `light` / `dark` 三种主题模式，初始未选择时跟随系统外观，用户选择持久化于 renderer localStorage。

#### Scenario: 首次启动跟随系统
- **GIVEN** localStorage 无主题模式记录
- **WHEN** 应用启动
- **THEN** 生效主题等于系统 `prefers-color-scheme`（light 或 dark）
- **AND** 根元素 `data-theme` 与 `color-scheme` 与之一致

#### Scenario: 用户选择固定主题
- **GIVEN** 用户将模式选择为 `light` 或 `dark`
- **WHEN** 选择持久化到 localStorage 并生效
- **THEN** 生效主题固定在所选值，不再随系统外观变化

### Requirement: 运行期解析生效主题并响应系统变化
The system SHALL 在 `system` 模式下监听 `prefers-color-scheme` 变化并实时更新生效主题，非 `system` 模式下忽略系统变化。

#### Scenario: 跟随系统实时联动
- **GIVEN** 模式为 `system`，当前生效主题为 dark
- **WHEN** 系统外观切到 light
- **THEN** 生效主题随之变为 light，根元素 `data-theme` 同步更新

#### Scenario: 固定主题不随系统
- **GIVEN** 模式为 `dark`
- **WHEN** 系统外观在 light/dark 间切换
- **THEN** 生效主题保持 dark，`data-theme` 不变

### Requirement: 三段式切换入口
The system SHALL 在顶部导航区域提供「白天 / 暗黑 / 跟随系统」三段式切换控件，当前选择以 `aria-pressed` 标记，选择即时生效并持久化。

#### Scenario: 切换并持久化
- **GIVEN** 顶部导航显示三段式切换控件，当前为 `system`
- **WHEN** 用户点击「白天」并重新启动
- **THEN** 生效主题即时变为 light，且重启后仍为 light

### Requirement: 主题变量的浅色与暗色两套取值
The system SHALL 让 `theme.css` 的全部主题变量在浅色与暗色下各有一套取值，组件样式不再依赖浅色硬编码，确保两色下文字与背景对比度一致。

#### Scenario: 暗色基线沿用现状
- **GIVEN** 生效主题为 dark
- **WHEN** 页面渲染
- **THEN** 各组件颜色取值与既有暗色玻璃主题一致

#### Scenario: 浅色可读
- **GIVEN** 生效主题为 light
- **WHEN** 页面渲染
- **THEN** 背景、卡片、文字、边框、accent 均在浅色下清晰可读，无浅色底上白字等反差失效

### Requirement: color-scheme 跟随生效主题
The system SHALL 将根级 `color-scheme` 设置为当前生效主题（dark→`dark`、light→`light`），使原生控件与滚动条配色随主题。

#### Scenario: 原生配色跟随
- **GIVEN** 生效主题为 light
- **WHEN** 页面存在原生 select / 滚动条
- **THEN** 其配色为浅色模式，而非固定深色
