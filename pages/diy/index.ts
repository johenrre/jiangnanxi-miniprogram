import { canvasPageMethods } from '@/pages/diy/features/canvas'
import { designPageMethods } from '@/pages/diy/features/design'
import { dialogPageMethods } from '@/pages/diy/features/dialogs'
import { editorPageMethods } from '@/pages/diy/features/editor'
import { entryPageMethods } from '@/pages/diy/features/entry'
import { materialPageMethods } from '@/pages/diy/features/materials'
import { createDiyPageData } from '@/pages/diy/page/data'
import { lifecyclePageMethods } from '@/pages/diy/page/lifecycle'
import { createDiyRuntimeState } from '@/pages/diy/page/runtime'
import type { DiyPageCustom, DiyPageData } from '@/pages/diy/page/types'

Page<DiyPageData, DiyPageCustom>({
  data: createDiyPageData(),
  ...createDiyRuntimeState(),
  ...materialPageMethods,
  ...dialogPageMethods,
  ...entryPageMethods,
  ...canvasPageMethods,
  ...editorPageMethods,
  ...designPageMethods,
  ...lifecyclePageMethods,
})
