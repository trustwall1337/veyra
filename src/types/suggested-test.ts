export interface SuggestedTest {
  readonly id: string;
  readonly control_id: string;
  readonly title: string;
  readonly description: string;
  readonly negative_assertion: string;
}
