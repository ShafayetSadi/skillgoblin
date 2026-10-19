<template>
  <section
    v-if="renderedDescription"
    data-testid="course-description"
    class="bg-white dark:bg-gray-800 p-4 mb-6 rounded-lg shadow-sm"
    aria-labelledby="course-description-title"
  >
    <h2 id="course-description-title" class="text-lg font-semibold text-gray-900 dark:text-white mb-3">
      About this course
    </h2>
    <div
      class="course-description text-sm text-gray-700 dark:text-gray-300"
      v-html="renderedDescription"
    ></div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { renderCourseDescription } from '~/utils/courseDescriptionMarkdown.js';

const props = defineProps({
  description: {
    type: String,
    default: '',
  },
});

const renderedDescription = computed(() => renderCourseDescription(props.description));
</script>

<style scoped>
.course-description :deep(h3),
.course-description :deep(h4),
.course-description :deep(h5),
.course-description :deep(h6) {
  margin: 1rem 0 0.4rem;
  color: inherit;
  font-weight: 600;
  line-height: 1.35;
}

.course-description :deep(h3:first-child),
.course-description :deep(h4:first-child),
.course-description :deep(h5:first-child),
.course-description :deep(h6:first-child) {
  margin-top: 0;
}

.course-description :deep(h3) { font-size: 1.125rem; }
.course-description :deep(h4) { font-size: 1rem; }

.course-description :deep(p),
.course-description :deep(ul),
.course-description :deep(ol),
.course-description :deep(blockquote),
.course-description :deep(pre) {
  margin-bottom: 0.75rem;
}

.course-description :deep(ul),
.course-description :deep(ol) {
  padding-left: 1.5rem;
}

.course-description :deep(ul) { list-style: disc; }
.course-description :deep(ol) { list-style: decimal; }

.course-description :deep(a) {
  color: var(--color-primary-500);
  font-weight: 500;
  text-decoration: underline;
  overflow-wrap: anywhere;
}

.course-description :deep(a:hover) {
  color: var(--color-primary-600);
}

.course-description :deep(code) {
  border-radius: 0.25rem;
  background: color-mix(in srgb, currentColor 10%, transparent);
  padding: 0.1rem 0.25rem;
}

.course-description :deep(pre) {
  overflow-x: auto;
  border-radius: 0.375rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  padding: 0.75rem;
}

.course-description :deep(pre code) {
  background: transparent;
  padding: 0;
}

.course-description :deep(p:last-child),
.course-description :deep(ul:last-child),
.course-description :deep(ol:last-child),
.course-description :deep(blockquote:last-child),
.course-description :deep(pre:last-child) {
  margin-bottom: 0;
}
</style>
