package com.furqan.passpass;

import junit.framework.Test;
import junit.framework.TestCase;
import junit.framework.TestSuite;

/**
 * Unit test for PassPass App.
 */
public class AppTest 
    extends TestCase
{
    /**
     * Create the test case
     *
     * @param testName name of the test case
     */
    public AppTest( String testName )
    {
        super( testName );
    }

    /**
     * @return the suite of tests being tested
     */
    public static Test suite()
    {
        return new TestSuite( AppTest.class );
    }

    /**
     * Test the App class exists and can be instantiated
     */
    public void testApp()
    {
        App app = new App();
        assertNotNull("App should not be null", app);
    }
    
    /**
     * Test that the main method exists (basic smoke test)
     */
    public void testMainMethodExists()
    {
        try {
            App.class.getMethod("main", String[].class);
            assertTrue("Main method should exist", true);
        } catch (NoSuchMethodException e) {
            fail("Main method should exist");
        }
    }
}
