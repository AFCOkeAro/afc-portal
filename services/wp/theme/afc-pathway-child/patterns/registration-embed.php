<?php
/**
 * Title: AFC Registration Embed
 * Slug: afc-pathway-child/registration-embed
 * Categories: afc
 * Description: FREE registration form — Step-1 audience selector (Youth self / Guardian for teen), no payment fields, server-side submit to the portal. WP stores no PII.
 */
?>
<!-- wp:group -->
<div class="wp-block-group" id="register"><!-- wp:heading {"level":2} --><h2>One flow. Who are you registering?</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Single column, one question per screen on mobile. Inline validation, review-before-submit, confirmation with reference ID.</p><!-- /wp:paragraph -->
<!-- wp:html -->
<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="afc-register">
<?php wp_nonce_field( 'afc_ystc_register' ); ?>
<input type="hidden" name="action" value="afc_ystc_register" />
<fieldset class="afc-audience">
<legend>Step 1 — Audience</legend>
<label><input type="radio" name="audience" value="youth-self" checked="checked" /> <strong>Youth — registering myself</strong><br /><span>Name, 11-digit phone, email/WhatsApp optional.</span></label>
<label><input type="radio" name="audience" value="guardian-teen" /> <strong>Guardian — registering a teen</strong><br /><span>Guardian details first, then teen + consent checkbox.</span></label>
</fieldset>
<p><label for="afc-name">Full name *</label><input id="afc-name" name="full_name" type="text" autocomplete="name" required="required" minlength="2" placeholder="Enter your full name" /></p>
<p><label for="afc-phone">Phone *</label><input id="afc-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required="required" pattern="[0-9]{11}" placeholder="0803 123 4567" /><small>11 digits.</small></p>
<p><label for="afc-branch">Branch / fellowship <span>(optional)</span></label><select id="afc-branch" name="branch"><option value="">Oke Aro HQ</option><option value="tba">Branch TBA</option></select></p>
<p class="afc-guardian-consent"><label><input type="checkbox" name="guardian_consent" value="1" /> I am the guardian and I consent to this teen's registration. <span class="afc-badge afc-badge--tba">Required for teen path</span></label></p>
<p><span class="afc-badge afc-badge--free">FREE — no payment step</span></p>
<p><button type="submit" class="wp-element-button">Submit registration — free</button></p>
<p><small>Submits server-side to the portal; no details are stored in WordPress.</small></p>
</form>
<!-- /wp:html -->
</div>
<!-- /wp:group -->
