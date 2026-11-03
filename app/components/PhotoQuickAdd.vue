<script setup lang="ts">
import type { WishList } from '../../shared/types'
import { productSchema } from '../../shared/validation'

const props = defineProps<{ lists: WishList[]; initialListId: string }>()
const store = useWishlists()
const opened = ref(false)
const camera = ref<HTMLInputElement>()
const library = ref<HTMLInputElement>()
const preview = ref('')
const photoError = ref('')
const name = ref('')
const variant = ref('')
const notes = ref('')
const category = ref('Other')
const selected = ref([props.initialListId].filter(Boolean))
const saved = ref<string[]>([])
const batchWishIds = ref<string[]>([])
const saving = ref(false)
const error = ref('')
const pending = computed(() => selected.value.filter(id => !saved.value.includes(id) && props.lists.some(l => l.id === id)))
const savedNames = computed(() => props.lists.filter(l => saved.value.includes(l.id)).map(l => l.name).join(', '))
const complete = computed(() => saved.value.length > 0 && pending.value.length === 0)

function releasePhoto() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
}
function choosePhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // Allow choosing the same photo again after removing it.
  if (!file) return
  photoError.value = ''
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'].includes(file.type)) {
    photoError.value = 'Choose a JPG, PNG, WebP, HEIC, or AVIF photo.'; return
  }
  if (file.size > 20 * 1024 * 1024) { photoError.value = 'Choose a photo smaller than 20 MB.'; return }
  releasePhoto()
  preview.value = URL.createObjectURL(file)
}
function reset() {
  releasePhoto(); photoError.value = ''; error.value = ''
  name.value = ''; variant.value = ''; notes.value = ''; category.value = 'Other'
  saved.value = []; batchWishIds.value = []; selected.value = [props.initialListId].filter(Boolean)
}
async function add() {
  if (saving.value || !pending.value.length || !preview.value) return
  const result = productSchema.safeParse({ name: name.value.trim(), variant: variant.value.trim(), notes: notes.value.trim(), category: category.value,
    msrp_cents: null, msrp_source_url: null, offers: [], image_mode: 'auto', image_url: null, image_source_url: null })
  if (!result.success) { error.value = result.error.issues[0]?.message || 'Check the item details.'; return }
  saving.value = true; error.value = ''
  try {
    // Each confirmed save is kept on failure, so retrying only submits the remaining lists.
    for (const id of [...pending.value]) {
      const beforeIds = new Set(store.items.value.map(item => item.id))
      await store.saveItem(result.data, null, undefined, undefined, undefined, id, batchWishIds.value)
      batchWishIds.value.push(...store.items.value.filter(item => !beforeIds.has(item.id)).map(item => item.id))
      saved.value.push(id)
    }
    releasePhoto()
  } catch {
    error.value = 'Could not finish saving. Your successful saves are kept; try again for the remaining lists.'
  } finally { saving.value = false }
}
onBeforeUnmount(releasePhoto)
</script>

<template>
  <section class="feature-panel photo-quick-add form-stack" aria-labelledby="photo-add-heading">
    <div class="photo-add-heading"><div><h2 id="photo-add-heading">A wish, in a snap.</h2><p class="field-note">Quick add from a photo</p></div><span class="photo-stub-badge">Preview</span></div>
    <p class="field-note">Photo recognition is coming. For now, use a photo as a reference and enter the item’s name. Your photo stays on this device and isn’t saved with the wish.</p>
    <button v-if="!opened" type="button" class="secondary-button" aria-expanded="false" @click="opened = true"><WishIcon name="camera" :size="19" />Add from a photo</button>
    <form v-else class="form-stack" @submit.prevent="add">
      <template v-if="!complete">
        <div v-if="!saved.length" class="photo-actions">
          <button type="button" class="secondary-button" :disabled="saving" @click="camera?.click()"><WishIcon name="camera" :size="18" />{{ preview ? 'Retake photo' : 'Take a photo' }}</button>
          <button type="button" class="secondary-button" :disabled="saving" @click="library?.click()">Choose a photo</button>
          <input ref="camera" class="photo-file-input" type="file" accept="image/*" capture="environment" aria-label="Take an item photo" tabindex="-1" @change="choosePhoto" />
          <input ref="library" class="photo-file-input" type="file" accept="image/*" aria-label="Choose an item photo" tabindex="-1" @change="choosePhoto" />
        </div>
        <figure v-if="preview" class="capture-photo-preview"><img :src="preview" alt="Your item photo reference" @error="photoError = 'This browser can’t preview this photo. You can still enter the details, or choose a JPG or PNG.'" /><figcaption>Temporary reference · not uploaded</figcaption></figure>
        <p v-if="photoError" class="error-message" role="alert">{{ photoError }}</p>
        <button v-if="preview && !saved.length" type="button" class="text-button" :disabled="saving" @click="releasePhoto(); photoError = ''">Remove photo</button>
        <template v-if="preview">
          <fieldset class="photo-item-fields form-stack" :disabled="saving || saved.length > 0">
            <legend class="sr-only">Item details</legend>
            <label>Item name<input v-model="name" required maxlength="200" placeholder="What caught your eye?" /></label>
            <div class="form-row"><label>Variant<input v-model="variant" maxlength="200" placeholder="Model, size, color…" /></label><label>Item category<select v-model="category"><option>Tech</option><option>Home</option><option>Style</option><option>Books</option><option>Outdoors</option><option>Other</option></select></label></div>
            <label>A note for later<textarea v-model="notes" maxlength="2000" rows="2" placeholder="Store, shelf price, or a little reminder…" /></label>
          </fieldset>
          <fieldset class="photo-list-choices"><legend>Add to your lists</legend><label v-for="list in lists" :key="list.id"><input v-model="selected" type="checkbox" :value="list.id" :disabled="saving || saved.includes(list.id)" /><span>{{ list.name }}{{ saved.includes(list.id) ? ' · Added' : '' }}</span></label></fieldset>
          <p class="field-note">Saved wishes use category artwork. Add a store link later for product pictures and price checks.</p>
          <button class="primary-button" :disabled="saving || !pending.length || !name.trim()">{{ saving ? 'Adding…' : `Add to ${pending.length === 1 ? '1 list' : `${pending.length} lists`}` }}<WishIcon name="arrow" :size="17" /></button>
        </template>
      </template>
      <p v-if="saved.length" class="success-message" role="status">{{ name }} added to {{ savedNames }}. <NuxtLink to="/">View your lists →</NuxtLink></p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <button v-if="complete" type="button" class="secondary-button" @click="reset">Add another item</button>
      <button v-if="!saving" type="button" class="text-button" @click="reset(); opened = false">{{ saved.length ? 'Done' : 'Cancel photo quick add' }}</button>
    </form>
  </section>
</template>
